import { isNull } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import { XMTP_SOURCE } from '@/plugins/xmtp/constants'
import {
  ChannelType,
  EventType,
  IAgentRuntime,
  Memory,
  MessagePayload,
  stringToUuid
} from '@elizaos/core'
import type { Reply } from '@xmtp/content-type-reply'
import { ContentTypeReply } from '@xmtp/content-type-reply'
import { ContentTypeText } from '@xmtp/content-type-text'

import { DecodedMessage, Dm, Group, Client as XmtpClient, type Conversation } from '@xmtp/node-sdk'
import { z } from 'zod'

export class XMTPManager {
  runtime: IAgentRuntime
  private client: XmtpClient

  constructor(runtime: IAgentRuntime, client: XmtpClient) {
    this.runtime = runtime
    this.client = client
  }

  async start(): Promise<void> {
    ayaLogger.info('XMTP client started')

    ayaLogger.info('Syncing conversations...')
    await this.client.conversations.sync()

    ayaLogger.info(
      `[XMTP] Send a message on http://xmtp.chat/dm/${this.client.accountIdentifier?.identifier}`
    )

    ayaLogger.info('Waiting for messages...')
    const stream = this.client.conversations.streamAllMessages()

    ayaLogger.info('✅ XMTP client started')

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

      ayaLogger.info(`Received message: ${message.content} by ${message.senderInboxId}`)

      const conversation = await this.client.conversations.getConversationById(
        message.conversationId
      )

      if (isNull(conversation)) {
        ayaLogger.warn('Unable to find conversation, skipping')
        continue
      }

      // Check if this is a group chat and if we should respond
      if (!(await this.shouldProcessMessage(message, conversation))) {
        ayaLogger.info('Skipping message - not mentioned in group chat')
        continue
      }

      await this.processMessage(message, conversation)

      ayaLogger.info('Waiting for messages...')
    }
  }

  /**
   * Determines if we should process a message based on conversation type and mentions
   * - Always process DM messages
   * - Only process group messages if bot is mentioned by address or username
   */
  private async shouldProcessMessage(
    message: DecodedMessage,
    conversation: Conversation
  ): Promise<boolean> {
    // Always process DM messages
    if (conversation instanceof Dm) {
      return true
    }

    // For group chats, only process if mentioned
    if (conversation instanceof Group) {
      return this.isBotMentioned(message)
    }

    // Default to processing (fallback for unknown conversation types)
    return true
  }

  /**
   * Checks if the bot is mentioned in the message by address or username
   */
  private isBotMentioned(message: DecodedMessage): boolean {
    const messageText = z.string().safeParse(message.content)
    if (!messageText.success || !messageText.data) {
      return false
    }

    const text = messageText.data.toLowerCase()
    const botInboxId = this.client.inboxId.toLowerCase()
    const botAddress = this.client.accountIdentifier?.identifier?.toLowerCase()

    // Check for mention by inbox ID
    if (text.includes(botInboxId)) {
      ayaLogger.info(`Bot mentioned by inbox ID: ${botInboxId}`)
      return true
    }

    // Check for mention by address/identifier
    if (botAddress && text.includes(botAddress)) {
      ayaLogger.info(`Bot mentioned by address: ${botAddress}`)
      return true
    }

    // Check for common mention patterns like @address or @username
    if (botAddress && text.includes(`@${botAddress}`)) {
      ayaLogger.info(`Bot mentioned with @ symbol: @${botAddress}`)
      return true
    }

    if (text.includes(`@${botInboxId}`)) {
      ayaLogger.info(`Bot mentioned with @ symbol: @${botInboxId}`)
      return true
    }

    const xmptEnsName = this.runtime.getSetting('XMTP_ENS_NAME')
    if (xmptEnsName && text.includes(xmptEnsName)) {
      ayaLogger.info(`Bot mentioned with ENS name: ${xmptEnsName}`)
      return true
    }

    return false
  }

  private async processMessage(message: DecodedMessage, conversation: Conversation): Promise<void> {
    const memory = await this.ensureMessageConnection(message, conversation)

    if (isNull(memory.content.text) || memory.content.text.trim() === '') {
      ayaLogger.warn(`skipping message with no text: ${message.id}`)
      return
    }

    const messageReceivedPayload: MessagePayload = {
      runtime: this.runtime,
      message: memory,
      source: XMTP_SOURCE,
      callback: async (content) => {
        const reply: Reply = {
          reference: message.id,
          content: content.text,
          contentType: ContentTypeText
        }

        ayaLogger.info(`[XMTP] message received response: ${content.text}`)
        await conversation.send(reply, ContentTypeReply)
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
      ayaLogger.error(`Error in XMTP ensureMessageConnection: ${error}`)
      throw error
    }
  }

  async stop(): Promise<void> {
    ayaLogger.warn('XMTP client does not support stopping yet')
  }
}
