import { sendCast } from '@/clients/farcaster/actions'
import type { FarcasterClient } from '@/clients/farcaster/client'
import { buildConversationThread, createCastMemory } from '@/clients/farcaster/memory'
import {
  formatCast,
  formatTimeline,
  messageHandlerTemplate,
  shouldRespondTemplate
} from '@/clients/farcaster/prompts'
import type { Cast, Profile } from '@/clients/farcaster/types'
import { castUuid } from '@/clients/farcaster/utils'
import { hasActions } from '@/common/functions'
import { AgentcoinRuntime } from '@/common/runtime'
import {
  composeContext,
  type Content,
  elizaLogger,
  generateMessageResponse,
  generateShouldRespond,
  type HandlerCallback,
  type Memory,
  ModelClass,
  stringToUuid
} from '@elizaos/core'
import { toHex } from 'viem'

export class FarcasterInteractionManager {
  private timeout: NodeJS.Timeout | undefined
  constructor(
    public client: FarcasterClient,
    public runtime: AgentcoinRuntime,
    private signerUuid: string,
    public cache: Map<string, unknown>
  ) {}

  public async start(): Promise<void> {
    const handleInteractionsLoop = async (): Promise<void> => {
      try {
        await this.handleInteractions()
      } catch (error) {
        elizaLogger.error(error)
      }

      // Always set up next check, even if there was an error
      this.timeout = setTimeout(
        handleInteractionsLoop,
        Number(this.client.farcasterConfig?.FARCASTER_POLL_INTERVAL ?? 120) * 1000
      )
    }

    void handleInteractionsLoop()
  }

  public async stop(): Promise<void> {
    if (this.timeout) clearTimeout(this.timeout)
  }

  private async handleInteractions(): Promise<void> {
    const agentFid = this.client.farcasterConfig?.FARCASTER_FID ?? 0
    if (!agentFid) {
      elizaLogger.info('No FID found, skipping interactions')
      return
    }

    const mentions = await this.client.getMentions({
      fid: agentFid,
      pageSize: 20
    })

    const agent = await this.client.getProfile(agentFid)
    for (const mention of mentions) {
      const messageHash = toHex(mention.hash)
      const conversationId = `${messageHash}-${this.runtime.agentId}`
      const roomId = stringToUuid(conversationId)
      const userId = stringToUuid(mention.authorFid.toString())

      const pastMemoryId = castUuid({
        agentId: this.runtime.agentId,
        hash: mention.hash
      })

      const pastMemory = await this.runtime.messageManager.getMemoryById(pastMemoryId)

      if (pastMemory) {
        continue
      }

      elizaLogger.info('new mention received:', mention.text)

      const username = mention.profile.username

      await this.runtime.ensureUserRoomConnection({
        roomId,
        userId,
        username,
        name: mention.profile.name,
        email: username,
        source: 'farcaster'
      })

      const thread = await buildConversationThread({
        client: this.client,
        runtime: this.runtime,
        cast: mention
      })

      const memory: Memory = {
        content: { text: mention.text },
        agentId: this.runtime.agentId,
        userId,
        roomId
      }

      await this.handleCast({
        agent,
        cast: mention,
        memory,
        thread
      })
    }

    this.client.lastInteractionTimestamp = new Date()
  }

  private async handleCast({
    agent,
    cast,
    memory,
    thread
  }: {
    agent: Profile
    cast: Cast
    memory: Memory
    thread: Cast[]
  }): Promise<{ text: string; action: string }> {
    if (cast.profile.fid === agent.fid) {
      elizaLogger.info('skipping cast from bot itself', cast.hash)
      return
    }

    if (!memory.content.text) {
      elizaLogger.info('skipping cast with no text', cast.hash)
      return { text: '', action: 'IGNORE' }
    }

    const currentPost = formatCast(cast)

    const senderId = stringToUuid(cast.authorFid.toString())

    const { timeline } = await this.client.getTimeline({
      fid: agent.fid,
      pageSize: 10
    })

    const formattedTimeline = formatTimeline(this.runtime.character, timeline)

    const formattedConversation = thread
      .map(
        (cast) => `@${cast.profile.username} (${new Date(cast.timestamp).toLocaleString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          month: 'short',
          day: 'numeric'
        })}):
                ${cast.text}`
      )
      .join('\n\n')

    const state = await this.runtime.composeState(memory, {
      farcasterUsername: agent.username,
      timeline: formattedTimeline,
      currentPost,
      formattedConversation
    })

    const shouldRespondContext = composeContext({
      state,
      template:
        this.runtime.character.templates?.farcasterShouldRespondTemplate ||
        this.runtime.character?.templates?.shouldRespondTemplate ||
        shouldRespondTemplate
    })

    const memoryId = castUuid({
      agentId: this.runtime.agentId,
      hash: cast.hash
    })

    const castMemory = await this.runtime.messageManager.getMemoryById(memoryId)

    if (!castMemory) {
      await this.runtime.messageManager.createMemory(
        createCastMemory({
          roomId: memory.roomId,
          senderId,
          runtime: this.runtime,
          cast
        })
      )
    }

    const shouldRespondResponse = await generateShouldRespond({
      runtime: this.runtime,
      context: shouldRespondContext,
      modelClass: ModelClass.SMALL
    })

    if (shouldRespondResponse === 'IGNORE' || shouldRespondResponse === 'STOP') {
      elizaLogger.info(
        `Not responding to cast because generated ShouldRespond was ${shouldRespondResponse}`
      )
      return
    }

    const context = composeContext({
      state,
      template:
        this.runtime.character.templates?.farcasterMessageHandlerTemplate ??
        this.runtime.character?.templates?.messageHandlerTemplate ??
        messageHandlerTemplate
    })

    let shouldContinue = await this.runtime.handle('pre:llm', {
      state,
      responses: [],
      memory
    })

    if (!shouldContinue) {
      elizaLogger.info('AgentcoinClient received prellm event but it was suppressed')
      return
    }

    const responseContent = await generateMessageResponse({
      runtime: this.runtime,
      context,
      modelClass: ModelClass.LARGE
    })

    shouldContinue = await this.runtime.handle('post:llm', {
      state,
      responses: [],
      memory,
      content: responseContent
    })

    if (!shouldContinue) {
      elizaLogger.info('AgentcoinClient received postllm event but it was suppressed')
      return
    }

    responseContent.inReplyTo = memoryId

    if (!responseContent.text) return

    if (this.client.farcasterConfig?.FARCASTER_DRY_RUN) {
      elizaLogger.info(
        `Dry run: would have responded to cast ${cast.hash} with ${responseContent.text}`
      )
      return
    }

    const callback: HandlerCallback = async (content: Content, _files: unknown[]) => {
      try {
        if (memoryId && !content.inReplyTo) {
          content.inReplyTo = memoryId
        }
        const results = await sendCast({
          runtime: this.runtime,
          client: this.client,
          signerUuid: this.signerUuid,
          profile: cast.profile,
          content,
          roomId: memory.roomId,
          inReplyTo: {
            fid: cast.authorFid,
            hash: cast.hash
          }
        })
        // sendCast lost response action, so we need to add it back here
        results[0].memory.content.action = content.action

        for (const { memory } of results) {
          await this.runtime.messageManager.createMemory(memory)
        }
        return results.map((result) => result.memory)
      } catch (error) {
        elizaLogger.error('Error sending response cast:', error)
        return []
      }
    }

    const messageResponses = await callback(responseContent)

    const newState = await this.runtime.updateRecentMessageState(state)

    if (!hasActions(messageResponses)) {
      return
    }

    // `preaction` event
    shouldContinue = await this.runtime.handle('pre:action', {
      state,
      responses: messageResponses,
      memory
    })

    if (!shouldContinue) {
      elizaLogger.info('AgentcoinClient received preaction event but it was suppressed')
      return
    }

    await this.runtime.processActions(
      { ...memory, content: { ...memory.content, cast } },
      messageResponses,
      newState,
      async (newMessage) => {
        shouldContinue = await this.runtime.handle('post:action', {
          state,
          responses: messageResponses,
          memory,
          content: newMessage
        })

        if (!shouldContinue) {
          elizaLogger.info('AgentcoinClient received postaction event but it was suppressed')
          return
        }

        return callback(newMessage)
      }
    )
  }
}
