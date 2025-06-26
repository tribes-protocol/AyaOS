import { isNull } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import { XMTP_SOURCE } from '@/plugins/xmtp/constants'
import { XmtpContent } from '@/plugins/xmtp/types'
import {
  ChannelType,
  createUniqueUuid,
  EventType,
  IAgentRuntime,
  Memory,
  MessagePayload,
  UUID
} from '@elizaos/core'
import { ContentTypeReaction, Reaction } from '@xmtp/content-type-reaction'
import type { Reply } from '@xmtp/content-type-reply'
import { ContentTypeReply } from '@xmtp/content-type-reply'
import { ContentTypeText } from '@xmtp/content-type-text'
import { ContentTypeWalletSendCalls } from '@xmtp/content-type-wallet-send-calls'
import {
  DecodedMessage,
  Dm,
  Group,
  IdentifierKind,
  Client as XmtpClient,
  type Conversation
} from '@xmtp/node-sdk'
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
    const userMemory = await this.ensureMessageConnection(message, conversation)

    if (isNull(userMemory.content.text) || userMemory.content.text.trim() === '') {
      ayaLogger.warn(`skipping message with no text: ${message.id}`)
      return
    }

    const messageReceivedPayload: MessagePayload = {
      runtime: this.runtime,
      message: userMemory,
      source: XMTP_SOURCE,
      callback: async (content) => {
        const messageId = await this.sendMessage(message, conversation, content)
        const agentMemory = await this.createResponseMemory(
          conversation,
          content,
          messageId,
          userMemory.id
        )
        await this.runtime.createMemory(agentMemory, 'messages')
        return [agentMemory]
      }
    }
    await this.runtime.emitEvent(EventType.MESSAGE_RECEIVED, messageReceivedPayload)
  }

  private async sendMessage(
    message: DecodedMessage,
    conversation: Conversation,
    content: XmtpContent
  ): Promise<string> {
    if (content.transactionCalls) {
      return conversation.send(content.transactionCalls, ContentTypeWalletSendCalls)
    }

    if (content.reaction) {
      const reaction: Reaction = {
        ...content.reaction,
        reference: message.id
      }

      return conversation.send(reaction, ContentTypeReaction)
    }

    const reply: Reply = {
      reference: message.id,
      content: content.text,
      contentType: ContentTypeText
    }

    return conversation.send(reply, ContentTypeReply)
  }

  private async createResponseMemory(
    conversation: Conversation,
    content: XmtpContent,
    messageId: string,
    inReplyTo?: UUID
  ): Promise<Memory> {
    const entityId = this.runtime.agentId
    const roomId = createUniqueUuid(this.runtime, conversation.id)

    return {
      id: createUniqueUuid(this.runtime, messageId),
      agentId: this.runtime.agentId,
      content: {
        text: content.text,
        inReplyTo,
        source: XMTP_SOURCE,
        channelType: ChannelType.THREAD
      },
      entityId,
      roomId,
      createdAt: new Date().getTime()
    }
  }

  private async ensureMessageConnection(
    message: DecodedMessage,
    conversation: Conversation
  ): Promise<Memory> {
    try {
      const text = z.string().parse(message.content)
      const messageId = createUniqueUuid(this.runtime, message.id)
      const entityId = createUniqueUuid(this.runtime, message.senderInboxId)
      const roomId = createUniqueUuid(this.runtime, conversation.id)
      const worldId = createUniqueUuid(this.runtime, conversation.id)
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

      const conversationMembers = await conversation.members()
      let senderIdentifier: string | undefined
      conversationMembers.forEach((member) => {
        if (member.inboxId === message.senderInboxId) {
          senderIdentifier = member.accountIdentifiers.find(
            (identifier) => identifier.identifierKind === IdentifierKind.Ethereum
          )?.identifier
        }
      })

      const memory: Memory = {
        id: messageId,
        agentId: this.runtime.agentId,
        content: {
          text,
          source: XMTP_SOURCE,
          channelType: ChannelType.THREAD,
          senderIdentifier
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
