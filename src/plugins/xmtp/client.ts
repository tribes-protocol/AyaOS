import { isNull } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import { ContentTypeActions, ContentTypeIntent, IntentContentSchema } from '@/helpers/xmtpactions'
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

const ReplyContentSchema = z.object({
  reference: z.string(),
  content: z.string()
})

export class XMTPManager {
  runtime: IAgentRuntime
  public readonly client: XmtpClient

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

    const xmtpClient = this.client

    const onMessage = async (err: Error | null, message?: DecodedMessage): Promise<void> => {
      ayaLogger.log('New message received', { err, message })

      if (err) {
        ayaLogger.error('Error processing message', { err })
        return
      }

      if (isNull(message?.content)) {
        return
      }

      // Ignore own messages
      if (message.senderInboxId === this.client.inboxId) {
        return
      }

      ayaLogger.info(
        `Received message: ${JSON.stringify(message.content, null, 2)} by ${message.senderInboxId}`
      )

      const conversation = await this.client.conversations.getConversationById(
        message.conversationId
      )

      if (isNull(conversation)) {
        ayaLogger.warn('Unable to find conversation, skipping')
        return
      }

      // Check if this is a group chat and if we should respond
      if (!this.shouldProcessMessage(message, conversation)) {
        ayaLogger.info('Skipping message - not mentioned in group chat')
        return
      }

      void this.processMessage(message, conversation).catch((error) => {
        ayaLogger.error(`Error processing message: ${error}`)
      })

      ayaLogger.info('Waiting for messages...')
    }

    let timeout: NodeJS.Timeout | null = null

    const onFail = (): void => {
      ayaLogger.error('Stream failed')
      if (timeout) {
        clearTimeout(timeout)
      }
      timeout = setTimeout(() => {
        void handleStream()
      }, RETRY_INTERVAL)
    }

    const handleStream = async (): Promise<void> => {
      try {
        ayaLogger.info('Syncing conversations...')
        await xmtpClient.conversations.sync()

        // start stream
        const _stream = await xmtpClient.conversations.streamAllMessages(
          onMessage,
          undefined,
          undefined,
          onFail
        )
      } catch (error) {
        ayaLogger.error('Error syncing conversations', { error })
        onFail()
      }
    }

    ayaLogger.info('✅ XMTP client started. Waiting for messages...')
    await handleStream()
  }

  /**
   * Determines if we should process a message based on conversation type and mentions
   * - Always process DM messages
   * - Only process group messages if bot is mentioned by address or username
   *   or if it's a reply to the bot
   */
  private shouldProcessMessage(message: DecodedMessage, conversation: Conversation): boolean {
    // Always process DM messages
    if (conversation instanceof Dm) {
      return true
    }

    // For group chats, only process if mentioned or if it's a reply to the bot
    if (this.isConversationGroup(conversation)) {
      const isBotMentioned = this.isBotMentioned(message)
      const isReplyToBot = this.isReplyToBot(message)
      return isBotMentioned || isReplyToBot
    }

    // Default to processing (fallback for unknown conversation types)
    return true
  }

  private isConversationGroup(conversation: Conversation): boolean {
    return conversation instanceof Group
  }

  /**
   * Checks if the message is a reply to the bot
   */
  private isReplyToBot(message: DecodedMessage): boolean {
    // Check if this is a reply message
    if (isNull(message.contentType) || !message.contentType.sameAs(ContentTypeReply)) {
      return false
    }

    const replyContent = ReplyContentSchema.safeParse(message.content)

    if (!replyContent.success || isNull(replyContent.data)) {
      ayaLogger.warn('Failed to parse reply content')
      return false
    }

    const referenceMessage = this.client.conversations.getMessageById(replyContent.data.reference)
    if (isNull(referenceMessage)) {
      ayaLogger.warn('Failed to find reference message')
      return false
    }

    const isReplyToBot = referenceMessage.senderInboxId === this.client.inboxId
    if (isReplyToBot) {
      ayaLogger.info(`Reply detected to bot message: ${referenceMessage.id}`)
    }

    return isReplyToBot
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

    if (content.shouldReply) {
      const reply: Reply = {
        reference: message.id,
        content: content.text,
        contentType: ContentTypeText
      }

      return conversation.send(reply, ContentTypeReply)
    }

    if (content.xmtpActions) {
      return conversation.send(content.xmtpActions, ContentTypeActions)
    }

    return conversation.send(content.text, ContentTypeText)
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
        text: this.decodeXMTPContentToText(content),
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
      let text: string

      if (message.contentType?.sameAs(ContentTypeReply)) {
        const replyContent = ReplyContentSchema.safeParse(message.content)
        if (replyContent.success && replyContent.data) {
          text = replyContent.data.content
        } else {
          throw new Error('Failed to parse reply content')
        }
      } else if (message.contentType?.sameAs(ContentTypeIntent)) {
        const intentContent = IntentContentSchema.safeParse(message.content)
        if (intentContent.success && intentContent.data) {
          text = `User selected action: ${intentContent.data.metadata?.actionLabel}`
        } else {
          throw new Error('Failed to parse actions content')
        }
      } else {
        text = z.string().parse(message.content)
      }

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

      const channelType = this.isConversationGroup(conversation)
        ? ChannelType.GROUP
        : ChannelType.DM

      await this.runtime.ensureRoomExists({
        id: roomId,
        source: XMTP_SOURCE,
        type: channelType,
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
          type: channelType,
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
          channelType,
          senderIdentifier,
          xmtpMessageId: message.id
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

  decodeXMTPContentToText(content: XmtpContent): string {
    if (content.transactionCalls) {
      return JSON.stringify(content.transactionCalls)
    }

    if (content.reaction) {
      return JSON.stringify(content.reaction)
    }

    if (content.xmtpActions) {
      return JSON.stringify(content.xmtpActions)
    }

    return content.text || ''
  }

  async stop(): Promise<void> {
    ayaLogger.warn('XMTP client does not support stopping yet')
  }
}
