import { DecodedMessage, Client as XmtpClient, type Conversation } from '@xmtp/node-sdk'

import { isNull } from '@/common/functions'
import { XMTP_SOURCE } from '@/plugins/xmtp/constants'
import {
  ChannelType,
  elizaLogger,
  EventType,
  IAgentRuntime,
  Memory,
  MessagePayload,
  stringToUuid
} from '@elizaos/core'
import { z } from 'zod'

export class XMTPManager {
  runtime: IAgentRuntime
  private client: XmtpClient

  constructor(runtime: IAgentRuntime, client: XmtpClient) {
    this.runtime = runtime
    this.client = client
  }

  async start(): Promise<void> {
    elizaLogger.info('XMTP client started')

    elizaLogger.info('Syncing conversations...')
    await this.client.conversations.sync()

    elizaLogger.info(
      `Agent initialized on ${this.client.accountIdentifier}\n
      Send a message on http://xmtp.chat/dm/${this.client.accountIdentifier?.identifier}`
    )

    elizaLogger.info('Waiting for messages...')
    const stream = this.client.conversations.streamAllMessages()

    elizaLogger.info('✅ XMTP client started')

    for await (const message of await stream) {
      if (
        message?.senderInboxId.toLowerCase() === this.client.inboxId.toLowerCase() ||
        message?.contentType?.typeId !== 'text'
      ) {
        continue
      }

      // Ignore own messages
      if (message.senderInboxId === this.client.inboxId) {
        continue
      }

      elizaLogger.info(`Received message: ${message.content} by ${message.senderInboxId}`)

      const conversation = await this.client.conversations.getConversationById(
        message.conversationId
      )

      if (isNull(conversation)) {
        elizaLogger.warn('Unable to find conversation, skipping')
        continue
      }

      await this.processMessage(message, conversation)

      elizaLogger.info('Waiting for messages...')
    }
  }

  private async processMessage(message: DecodedMessage, conversation: Conversation): Promise<void> {
    const memory = await this.ensureMessageConnection(message, conversation)

    if (isNull(memory.content.text) || memory.content.text.trim() === '') {
      elizaLogger.warn(`skipping message with no text: ${message.id}`)
      return
    }

    const messageReceivedPayload: MessagePayload = {
      runtime: this.runtime,
      message: memory,
      source: XMTP_SOURCE,
      callback: async (content) => {
        elizaLogger.info(`[XMTP] message received response: ${content.text}`)
        await conversation.send(content.text)
        const memory = await this.createMessageMemory(message, conversation)
        await this.runtime.createMemory(memory, 'messages')
        return [memory]
      }
    }

    await this.runtime.emitEvent(EventType.MESSAGE_RECEIVED, messageReceivedPayload)
  }

  private async createMessageMemory(
    message: DecodedMessage,
    conversation: Conversation
  ): Promise<Memory> {
    const text = z.string().parse(message.content)
    const messageId = stringToUuid(message.id)
    const entityId = stringToUuid(message.senderInboxId)
    const roomId = stringToUuid(conversation.id)

    return {
      id: messageId,
      agentId: this.runtime.agentId,
      content: {
        text,
        source: XMTP_SOURCE,
        channelType: ChannelType.THREAD
      },
      entityId,
      roomId,
      createdAt: message.sentAt.getTime()
    }
  }

  private async ensureMessageConnection(
    message: DecodedMessage,
    conversation: Conversation
  ): Promise<Memory> {
    try {
      const text = z.string().parse(message.content)
      const messageId = stringToUuid(message.id)
      const entityId = stringToUuid(message.senderInboxId)
      const roomId = stringToUuid(conversation.id)
      const worldId = stringToUuid(conversation.id)
      const serverId = message.senderInboxId

      await this.runtime.ensureWorldExists({
        id: worldId,
        name: `${message.senderInboxId}'s XMTP`,
        agentId: this.runtime.agentId,
        serverId,
        metadata: {
          ownership: { ownerId: message.senderInboxId }
        }
      })

      await this.runtime.ensureRoomExists({
        id: roomId,
        name: `Thread with ${message.senderInboxId}`,
        source: XMTP_SOURCE,
        type: ChannelType.THREAD,
        channelId: conversation.id,
        serverId,
        worldId
      })

      if (entityId !== this.runtime.agentId) {
        await this.runtime.ensureConnection({
          entityId,
          roomId,
          userName: message.senderInboxId,
          name: message.senderInboxId,
          source: XMTP_SOURCE,
          type: ChannelType.THREAD,
          channelId: conversation.id,
          serverId,
          worldId
        })
      }

      const memory: Memory = {
        id: messageId,
        agentId: this.runtime.agentId,
        content: {
          text,
          source: XMTP_SOURCE,
          channelType: ChannelType.THREAD
        },
        entityId,
        roomId,
        createdAt: message.sentAt.getTime()
      }

      return memory
    } catch (error) {
      elizaLogger.error(`Error in XMTP ensureMessageConnection: ${error}`)
      throw error
    }
  }

  async stop(): Promise<void> {
    elizaLogger.warn('XMTP client does not support stopping yet')
  }
}
