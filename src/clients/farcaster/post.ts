import { sendCast } from '@/clients/farcaster/actions'
import type { FarcasterClient } from '@/clients/farcaster/client'
import { createCastMemory } from '@/clients/farcaster/memory'
import { formatTimeline, postTemplate } from '@/clients/farcaster/prompts'
import { castUuid, MAX_CAST_LENGTH } from '@/clients/farcaster/utils'
import { IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import { composeContext, generateText, ModelClass, stringToUuid } from '@elizaos/core'

export class FarcasterPostManager {
  client: FarcasterClient
  runtime: IAyaRuntime
  fid: number
  isDryRun: boolean
  private timeout: NodeJS.Timeout | undefined

  constructor(
    client: FarcasterClient,
    runtime: IAyaRuntime,
    private signerUuid: string,
    public cache: Map<string, unknown>
  ) {
    this.client = client
    this.runtime = runtime

    this.fid = this.client.farcasterConfig?.FARCASTER_FID ?? 0
    this.isDryRun = this.client.farcasterConfig?.FARCASTER_DRY_RUN ?? false

    // Log configuration on initialization
    ayaLogger.info('Farcaster Client Configuration:')
    ayaLogger.info(`- FID: ${this.fid}`)
    ayaLogger.info(`- Dry Run Mode: ${this.isDryRun ? 'enabled' : 'disabled'}`)
    ayaLogger.info(
      `- Enable Post: ${this.client.farcasterConfig.ENABLE_POST ? 'enabled' : 'disabled'}`
    )
    if (this.client.farcasterConfig.ENABLE_POST) {
      ayaLogger.info(
        `- Post Interval: ${this.client.farcasterConfig.POST_INTERVAL_MIN}-
        ${this.client.farcasterConfig.POST_INTERVAL_MAX} minutes`
      )
      ayaLogger.info(
        `- Post Immediately: ${this.client.farcasterConfig.POST_IMMEDIATELY ? 'enabled' : 'disabled'}`
      )
    }
    ayaLogger.info(
      `- Action Processing: ${this.client.farcasterConfig.ENABLE_ACTION_PROCESSING ? 'enabled' : 'disabled'}`
    )
    ayaLogger.info(`- Action Interval: ${this.client.farcasterConfig.ACTION_INTERVAL} minutes`)

    if (this.isDryRun) {
      ayaLogger.info(
        'Farcaster client initialized in dry run mode - no actual casts should be posted'
      )
    }
  }

  public async start(): Promise<void> {
    const generateNewCastLoop = async (): Promise<void> => {
      const lastPost = await this.runtime.cacheManager.get<{
        timestamp: number
      }>('farcaster/' + this.fid + '/lastPost')

      const lastPostTimestamp = lastPost?.timestamp ?? 0
      const minMinutes = this.client.farcasterConfig.POST_INTERVAL_MIN
      const maxMinutes = this.client.farcasterConfig.POST_INTERVAL_MAX
      const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes
      const delay = randomMinutes * 60 * 1000

      if (Date.now() > lastPostTimestamp + delay) {
        try {
          await this.generateNewCast()
        } catch (error) {
          ayaLogger.error(error)
          return
        }
      }

      this.timeout = setTimeout(() => {
        void generateNewCastLoop() // Set up next iteration
      }, delay)

      ayaLogger.info(`Next cast scheduled in ${randomMinutes} minutes`)
    }

    if (this.client.farcasterConfig.ENABLE_POST) {
      if (this.client.farcasterConfig.POST_IMMEDIATELY) {
        await this.generateNewCast()
      }
      void generateNewCastLoop()
    }
  }

  public async stop(): Promise<void> {
    if (this.timeout) clearTimeout(this.timeout)
  }

  private async generateNewCast(): Promise<void> {
    ayaLogger.info('Generating new cast')
    try {
      const profile = await this.client.getProfile(this.fid)

      const generatedRoomId = stringToUuid('user_farcaster_feed:' + profile.username)

      await this.runtime.ensureUserRoomConnection({
        roomId: generatedRoomId,
        userId: this.runtime.agentId,
        username: profile.username,
        name: profile.name,
        email: profile.username,
        source: 'farcaster'
      })

      const { timeline } = await this.client.getTimeline({
        fid: this.fid,
        pageSize: 10
      })

      this.cache.set('farcaster/timeline', timeline)

      const formattedHomeTimeline = formatTimeline(this.runtime.character, timeline)

      const state = await this.runtime.composeState(
        {
          roomId: generatedRoomId,
          userId: this.runtime.agentId,
          agentId: this.runtime.agentId,
          content: { text: '', action: '' }
        },
        {
          farcasterUserName: profile.username,
          timeline: formattedHomeTimeline
        }
      )

      // Generate new cast
      const context = composeContext({
        state,
        template: this.runtime.character.templates?.farcasterPostTemplate || postTemplate
      })

      let shouldContinue = await this.runtime.handle('pre:llm', {
        state,
        responses: [],
        memory: undefined
      })

      if (!shouldContinue) {
        ayaLogger.info('FarcasterPostManager received pre:llm event but it was suppressed')
        return
      }

      const newContent = await generateText({
        runtime: this.runtime,
        context,
        modelClass: ModelClass.SMALL
      })

      shouldContinue = await this.runtime.handle('post:llm', {
        state,
        responses: [],
        memory: undefined,
        content: { text: newContent }
      })

      if (!shouldContinue) {
        ayaLogger.info('FarcasterPostManager received post:llm event but it was suppressed')
        return
      }

      const slice = newContent.replaceAll(/\\n/g, '\n').trim()

      let content = slice.slice(0, MAX_CAST_LENGTH)

      // if it's bigger than the max limit, delete the last line
      if (content.length > MAX_CAST_LENGTH) {
        content = content.slice(0, content.lastIndexOf('\n'))
      }

      if (content.length > MAX_CAST_LENGTH) {
        // slice at the last period
        content = content.slice(0, content.lastIndexOf('.'))
      }

      // if it's still too long, get the period before the last period
      if (content.length > MAX_CAST_LENGTH) {
        content = content.slice(0, content.lastIndexOf('.'))
      }

      if (this.runtime.getSetting('FARCASTER_DRY_RUN') === 'true') {
        ayaLogger.info(`Dry run: would have cast: ${content}`)
        return
      }

      try {
        const [{ cast }] = await sendCast({
          client: this.client,
          runtime: this.runtime,
          signerUuid: this.signerUuid,
          roomId: generatedRoomId,
          content: { text: content },
          profile
        })

        await this.runtime.cacheManager.set(`farcaster/${this.fid}/lastCast`, {
          hash: cast.hash,
          timestamp: Date.now()
        })

        const roomId = castUuid({
          agentId: this.runtime.agentId,
          hash: cast.hash
        })

        await this.runtime.ensureRoomExists(roomId)

        await this.runtime.ensureParticipantInRoom(this.runtime.agentId, roomId)

        ayaLogger.info(`[Farcaster Neynar Client] Published cast ${cast.hash}`)

        await this.runtime.messageManager.createMemory(
          createCastMemory({
            roomId,
            senderId: this.runtime.agentId,
            runtime: this.runtime,
            cast
          })
        )
      } catch (error) {
        ayaLogger.error('Error sending cast:', error)
      }
    } catch (error) {
      ayaLogger.error('Error generating new cast:', error)
    }
  }
}
