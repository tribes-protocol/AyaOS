import { TelegramContent, TelegramEventTypes } from '@/plugins/telegram/types'
import { convertMarkdownToTelegram, convertToTelegramButtons } from '@/plugins/telegram/utils'
import {
  ChannelType,
  type Content,
  EventType,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  createUniqueUuid
} from '@elizaos/core'
import type { Message, Update } from '@telegraf/types'
import type { Context, NarrowedContext, Telegraf } from 'telegraf'
import { Markup } from 'telegraf'

import { isNull, isRequiredString, toJsonTreeString } from '@/common/functions'
import fs from 'node:fs'

/**
 * Enum representing different types of media.
 * @enum { string }
 * @readonly
 */
export enum MediaType {
  PHOTO = 'photo',
  VIDEO = 'video',
  DOCUMENT = 'document',
  AUDIO = 'audio',
  ANIMATION = 'animation'
}

const MAX_MESSAGE_LENGTH = 4096 // Telegram's max message length
const TYPING_INTERVAL_MS = 5000 // 5 seconds between typing indicators
const MAX_TYPING_DURATION_MS = 60000 // 60 seconds maximum

const getChannelType = (chatType: string): ChannelType => {
  if (chatType === 'private') return ChannelType.DM
  if (chatType === 'supergroup') return ChannelType.GROUP
  if (chatType === 'channel') return ChannelType.GROUP
  if (chatType === 'group') return ChannelType.GROUP

  throw new Error(`Unsupported chat type: ${chatType}`)
}

/**
 * Class representing a message manager.
 * @class
 */
export class MessageManager {
  public bot: Telegraf<Context>
  protected runtime: IAgentRuntime
  private typingIntervals: Map<string, { interval: NodeJS.Timeout; startTime: number }> = new Map()

  /**
   * Constructor for creating a new instance of a BotAgent.
   *
   * @param {Telegraf<Context>} bot - The Telegraf instance used for interacting with the bot
   *  platform.
   * @param {IAgentRuntime} runtime - The runtime environment for the agent.
   */
  constructor(bot: Telegraf<Context>, runtime: IAgentRuntime) {
    this.bot = bot
    this.runtime = runtime
  }

  // Process image messages and generate descriptions
  /**
   * Process an image from a Telegram message to extract the image URL and description.
   *
   * @param {Message} message - The Telegram message object containing the image.
   * @returns {Promise<{ description: string } | null>} The description of the processed image
   * or null if no image found.
   */
  async processImage(message: Message): Promise<{ description: string } | null> {
    try {
      let imageUrl: string | null = null

      console.debug(`Telegram Message: ${toJsonTreeString(message, { pretty: true })}`)

      if ('photo' in message && message.photo?.length > 0) {
        const photo = message.photo[message.photo.length - 1]
        const fileLink = await this.bot.telegram.getFileLink(photo.file_id)
        imageUrl = fileLink.toString()
      } else if ('document' in message && message.document?.mime_type?.startsWith('image/')) {
        const fileLink = await this.bot.telegram.getFileLink(message.document.file_id)
        imageUrl = fileLink.toString()
      }

      if (imageUrl) {
        const { title, description } = await this.runtime.useModel(
          ModelType.IMAGE_DESCRIPTION,
          imageUrl
        )
        return { description: `[Image: ${title}\n${description}]` }
      }
    } catch (error) {
      console.error('❌ Error processing image:', error)
    }

    return null
  }

  async sendMessageInChunks(
    ctx: Context,
    content: TelegramContent,
    replyToMessageId?: number
  ): Promise<Message.CommonMessage[]> {
    if (content.attachments && content.attachments.length > 0) {
      const sentMessages: Message.CommonMessage[] = []
      for (const attachment of content.attachments) {
        const typeMap: { [key: string]: MediaType } = {
          'image/gif': MediaType.ANIMATION,
          image: MediaType.PHOTO,
          doc: MediaType.DOCUMENT,
          video: MediaType.VIDEO,
          audio: MediaType.AUDIO
        }

        let mediaType: MediaType | undefined

        for (const prefix in typeMap) {
          if (attachment.contentType && attachment.contentType.startsWith(prefix)) {
            mediaType = typeMap[prefix]
            break
          }
        }

        if (!mediaType) {
          throw new Error(`Unsupported Telegram attachment content type: ${attachment.contentType}`)
        }

        const sentMessage = await this.sendMedia(
          ctx,
          attachment.url,
          mediaType,
          attachment.description
        )
        if (sentMessage) {
          sentMessages.push(sentMessage)
        }
      }
      return sentMessages
    } else {
      if (isNull(content.text)) return []

      const chatId = ctx.chat?.id

      if (isNull(chatId)) {
        throw new Error('Chat ID is undefined')
      }

      const chunks = this.splitMessage(content.text)
      const sentMessages: Message.TextMessage[] = []

      const telegramButtons = convertToTelegramButtons(content.buttons ?? [])

      for (let i = 0; i < chunks.length; i++) {
        const chunk = convertMarkdownToTelegram(chunks[i])
        const sentMessage = await ctx.telegram.sendMessage(chatId, chunk, {
          reply_parameters:
            i === 0 && replyToMessageId ? { message_id: replyToMessageId } : undefined,
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(telegramButtons)
        })

        sentMessages.push(sentMessage)
      }

      return sentMessages
    }
  }

  /**
   * Sends media to a chat using the Telegram API.
   *
   * @param {Context} ctx - The context object containing information about the current chat.
   * @param {string} mediaPath - The path to the media to be sent, either a URL or a local file
   * path.
   * @param {MediaType} type - The type of media being sent (PHOTO, VIDEO, DOCUMENT, AUDIO,
   * or ANIMATION).
   * @param {string} [caption] - Optional caption for the media being sent.
   *
   * @returns {Promise<void>} A Promise that resolves when the media is successfully sent.
   */
  async sendMedia(
    ctx: Context,
    mediaPath: string,
    type: MediaType,
    caption?: string
  ): Promise<Message.CommonMessage> {
    const chatId = ctx.chat?.id

    if (isNull(chatId)) {
      throw new Error('Chat ID is undefined')
    }

    try {
      const isUrl = /^(http|https):\/\//.test(mediaPath)
      const sendFunctionMap = {
        [MediaType.PHOTO]: ctx.telegram.sendPhoto.bind(ctx.telegram),
        [MediaType.VIDEO]: ctx.telegram.sendVideo.bind(ctx.telegram),
        [MediaType.DOCUMENT]: ctx.telegram.sendDocument.bind(ctx.telegram),
        [MediaType.AUDIO]: ctx.telegram.sendAudio.bind(ctx.telegram),
        [MediaType.ANIMATION]: ctx.telegram.sendAnimation.bind(ctx.telegram)
      }

      const sendFunction = sendFunctionMap[type]

      if (!sendFunction) {
        throw new Error(`Unsupported media type: ${type}`)
      }

      if (isUrl) {
        // Handle HTTP URLs
        return await sendFunction(chatId, mediaPath, { caption })
      } else {
        // Handle local file paths
        if (!fs.existsSync(mediaPath)) {
          throw new Error(`File not found at path: ${mediaPath}`)
        }

        const fileStream = fs.createReadStream(mediaPath)

        try {
          return await sendFunction(chatId, { source: fileStream }, { caption })
        } finally {
          fileStream.destroy()
        }
      }
    } catch (error) {
      console.error(`Failed to send ${type}. Path: ${mediaPath}. Error:`, error)
      throw error
    }
  }

  // Split message into smaller parts
  /**
   * Splits a given text into an array of strings based on the maximum message length.
   *
   * @param {string} text - The text to split into chunks.
   * @returns {string[]} An array of strings with each element representing a chunk of the
   * original text.
   */
  private splitMessage(text: string): string[] {
    const chunks: string[] = []
    let currentChunk = ''

    const lines = text.split('\n')
    for (const line of lines) {
      if (currentChunk.length + line.length + 1 <= MAX_MESSAGE_LENGTH) {
        currentChunk += (currentChunk ? '\n' : '') + line
      } else {
        if (currentChunk) chunks.push(currentChunk)
        currentChunk = line
      }
    }

    if (currentChunk) chunks.push(currentChunk)
    return chunks
  }

  /**
   * Starts a typing indicator that repeats at intervals for a specific chat
   * @param chatId The chat ID to show typing indicator in
   * @private
   */
  private startTypingIndicator(chatId: number | string): void {
    const chatIdStr = chatId.toString()

    // Clear any existing interval for this chat
    this.clearTypingIndicator(chatIdStr)

    const startTime = Date.now()

    // Send initial typing indicator immediately
    void this.bot.telegram.sendChatAction(chatId, 'typing').catch((error) => {
      console.error('Failed to send initial typing action:', error)
    })

    // Create interval for repeating typing indicators
    const interval = setInterval(() => {
      try {
        // Check if we've been typing too long
        if (Date.now() - startTime > MAX_TYPING_DURATION_MS) {
          this.clearTypingIndicator(chatIdStr)
          return
        }

        void this.bot.telegram.sendChatAction(chatId, 'typing')
      } catch (error) {
        this.clearTypingIndicator(chatIdStr)
        console.error('Failed to send typing action:', error)
      }
    }, TYPING_INTERVAL_MS)

    // Store the interval and start time
    this.typingIntervals.set(chatIdStr, { interval, startTime })
  }

  /**
   * Clears typing indicator interval for a specific chat
   * @param chatId The chat ID to clear typing indicator for
   * @private
   */
  private clearTypingIndicator(chatId: string): void {
    const typing = this.typingIntervals.get(chatId)
    if (typing) {
      clearInterval(typing.interval)
      this.typingIntervals.delete(chatId)
    }
  }

  private isMessageForMe(message: Message): boolean {
    const botUsername = this.bot.botInfo?.username
    if (!botUsername) return false

    const messageText =
      'text' in message ? message.text : 'caption' in message ? message.caption : ''
    if (!messageText) return false

    const isReplyToBot =
      'reply_to_message' in message &&
      message.reply_to_message?.from?.is_bot === true &&
      message.reply_to_message?.from?.username === botUsername
    const isMentioned = messageText.includes(`@${botUsername}`)

    return isReplyToBot || isMentioned
  }

  private shouldRespondToMessage(message: Message): boolean {
    // Respond to private chats
    if (message.chat.type === 'private') {
      return true
    }

    // For group chats, only respond to direct mentions
    if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
      return this.isMessageForMe(message)
    }

    return false
  }

  // Main handler for incoming messages
  /**
   * Handle incoming messages from Telegram and process them accordingly.
   * @param {Context} ctx - The context object containing information about the message.
   * @returns {Promise<void>}
   */
  public async handleMessage(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id

    if (isNull(chatId)) {
      throw new Error('Chat ID is undefined')
    }

    // Type guard to ensure message exists
    if (!ctx.message || !ctx.from) return

    if (!this.shouldRespondToMessage(ctx.message)) return

    const message = ctx.message

    try {
      // Convert IDs to UUIDs
      const entityId = createUniqueUuid(this.runtime, ctx.from.id.toString())

      const threadId =
        'is_topic_message' in message && message.is_topic_message
          ? message.message_thread_id?.toString()
          : undefined

      // Generate room ID based on whether this is in a forum topic
      const roomId = createUniqueUuid(
        this.runtime,
        threadId ? `${chatId}-${threadId}` : chatId.toString()
      )

      // Get message ID
      const messageId = createUniqueUuid(this.runtime, message?.message_id?.toString())

      // Handle images
      const imageInfo = await this.processImage(message)

      // Get message text - use type guards for safety
      let messageText = ''
      if ('text' in message && message.text) {
        messageText = message.text
      } else if ('caption' in message && message.caption) {
        messageText = message.caption
      }

      // Combine text and image description
      const fullText = imageInfo ? `${messageText} ${imageInfo.description}` : messageText
      if (!fullText) return

      // Get chat type and determine channel type
      const chat = message.chat
      const channelType = getChannelType(chat.type)

      // Create the memory object
      const memory: Memory = {
        id: messageId,
        entityId,
        agentId: this.runtime.agentId,
        roomId,
        content: {
          text: fullText,
          source: 'telegram',
          channelType,
          inReplyTo:
            'reply_to_message' in message && message.reply_to_message
              ? createUniqueUuid(this.runtime, message.reply_to_message.message_id.toString())
              : undefined
        },
        createdAt: message.date * 1000
      }

      // Create callback for handling responses
      const callback: HandlerCallback = async (content: Content, _files?: string[]) => {
        try {
          // Clear typing indicator before sending response
          this.clearTypingIndicator(chatId.toString())

          // If response is from reasoning do not send it.
          if (!content.text) return []

          const sentMessages = await this.sendMessageInChunks(ctx, content, message.message_id)

          if (!sentMessages) return []

          const memories: Memory[] = []
          for (let i = 0; i < sentMessages.length; i++) {
            const sentMessage = sentMessages[i]

            let text: string | undefined
            if ('text' in sentMessage && isRequiredString(sentMessage.text)) {
              text = sentMessage.text
            }

            if (isNull(text)) {
              continue
            }

            const responseMemory: Memory = {
              id: createUniqueUuid(this.runtime, sentMessage.message_id.toString()),
              entityId: this.runtime.agentId,
              agentId: this.runtime.agentId,
              roomId,
              content: {
                ...content,
                text,
                inReplyTo: messageId,
                channelType
              },
              createdAt: sentMessage.date * 1000
            }

            await this.runtime.createMemory(responseMemory, 'messages')
            memories.push(responseMemory)
          }

          return memories
        } catch (error) {
          // Clear typing indicator in case of error too
          this.clearTypingIndicator(chatId.toString())
          console.error('Error in message callback:', error)
          return []
        }
      }

      // Start typing indicator
      this.startTypingIndicator(chatId)

      // Let the bootstrap plugin handle the message
      await this.runtime.emitEvent(EventType.MESSAGE_RECEIVED, {
        runtime: this.runtime,
        message: memory,
        callback,
        source: 'telegram'
      })

      // Also emit the platform-specific event
      await this.runtime.emitEvent(TelegramEventTypes.MESSAGE_RECEIVED, {
        runtime: this.runtime,
        message: memory,
        callback,
        source: 'telegram',
        ctx,
        originalMessage: message
      })
    } catch (error) {
      // Clear typing indicator in case of error
      if (chatId) {
        this.clearTypingIndicator(chatId.toString())
      }

      console.error('Error handling Telegram message:', {
        error,
        chatId: ctx.chat?.id,
        messageId: ctx.message?.message_id,
        from: ctx.from?.username || ctx.from?.id
      })
      throw error
    }
  }

  /**
   * Handles the reaction event triggered by a user reacting to a message.
   * @param {NarrowedContext<Context<Update>, Update.MessageReactionUpdate>} ctx The context of
   * the message reaction update
   * @returns {Promise<void>} A Promise that resolves when the reaction handling is complete
   */
  public async handleReaction(
    ctx: NarrowedContext<Context<Update>, Update.MessageReactionUpdate>
  ): Promise<void> {
    // Ensure we have the necessary data
    if (!ctx.update.message_reaction || !ctx.from) return

    const reaction = ctx.update.message_reaction
    const reactionType = reaction.new_reaction[0].type
    const reactionEmoji = reaction.new_reaction[0].type

    try {
      const entityId = createUniqueUuid(this.runtime, ctx.from.id.toString())
      const roomId = createUniqueUuid(this.runtime, ctx.chat.id.toString())

      const reactionId = createUniqueUuid(
        this.runtime,
        `${reaction.message_id}-${ctx.from.id}-${Date.now()}`
      )

      // Create reaction memory
      const memory: Memory = {
        id: reactionId,
        entityId,
        agentId: this.runtime.agentId,
        roomId,
        content: {
          channelType: getChannelType(reaction.chat.type),
          text: `Reacted with: ${reactionType === 'emoji' ? reactionEmoji : reactionType}`,
          source: 'telegram',
          inReplyTo: createUniqueUuid(this.runtime, reaction.message_id.toString())
        },
        createdAt: Date.now()
      }

      // Create callback for handling reaction responses
      const callback: HandlerCallback = async (content: Content) => {
        try {
          if (isNull(content.text)) return []
          const sentMessage = await ctx.reply(content.text)
          const responseMemory: Memory = {
            id: createUniqueUuid(this.runtime, sentMessage.message_id.toString()),
            entityId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId,
            content: {
              ...content,
              inReplyTo: reactionId
            },
            createdAt: sentMessage.date * 1000
          }
          return [responseMemory]
        } catch (error) {
          console.error('Error in reaction callback:', error)
          return []
        }
      }

      // Let the bootstrap plugin handle the reaction
      await this.runtime.emitEvent(EventType.REACTION_RECEIVED, {
        runtime: this.runtime,
        message: memory,
        callback,
        source: 'telegram'
      })

      // Also emit the platform-specific event
      await this.runtime.emitEvent(TelegramEventTypes.REACTION_RECEIVED, {
        runtime: this.runtime,
        message: memory,
        callback,
        source: 'telegram',
        ctx,
        reactionString: reactionType === 'emoji' ? reactionEmoji : reactionType,
        originalReaction: reaction.new_reaction[0]
      })
    } catch (error) {
      console.error('Error handling reaction:', error)
    }
  }

  /**
   * Sends a message to a Telegram chat and emits appropriate events
   * @param {number | string} chatId - The Telegram chat ID to send the message to
   * @param {Content} content - The content to send
   * @param {number} [replyToMessageId] - Optional message ID to reply to
   * @returns {Promise<Message.CommonMessage[]>} The sent messages
   */
  public async sendMessage(
    chatId: number | string,
    content: TelegramContent,
    replyToMessageId?: number
  ): Promise<Message.CommonMessage[]> {
    try {
      // Clear typing indicator before sending direct message
      this.clearTypingIndicator(chatId.toString())

      // Create a context-like object for sending
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const ctx = {
        chat: { id: chatId },
        telegram: this.bot.telegram
      } as Context

      const sentMessages = await this.sendMessageInChunks(ctx, content, replyToMessageId)

      if (!sentMessages?.length) return []

      // Create room ID
      const roomId = createUniqueUuid(this.runtime, chatId.toString())

      // Create memories for the sent messages
      const memories: Memory[] = []
      for (const sentMessage of sentMessages) {
        let text: string | undefined
        if ('text' in sentMessage && isRequiredString(sentMessage.text)) {
          text = sentMessage.text
        }

        if (isNull(text)) {
          continue
        }

        const memory: Memory = {
          id: createUniqueUuid(this.runtime, sentMessage.message_id.toString()),
          entityId: this.runtime.agentId,
          agentId: this.runtime.agentId,
          roomId,
          content: {
            ...content,
            text,
            source: 'telegram',
            channelType: getChannelType('private')
          },
          createdAt: sentMessage.date * 1000
        }

        await this.runtime.createMemory(memory, 'messages')
        memories.push(memory)
      }

      // Emit both generic and platform-specific message sent events
      await this.runtime.emitEvent(EventType.MESSAGE_SENT, {
        runtime: this.runtime,
        message: {
          content
        },
        roomId,
        source: 'telegram'
      })

      // Also emit platform-specific event
      await this.runtime.emitEvent(TelegramEventTypes.MESSAGE_SENT, {
        originalMessages: sentMessages,
        chatId
      })

      return sentMessages
    } catch (error) {
      // Clear typing indicator in case of error
      this.clearTypingIndicator(chatId.toString())
      console.error('Error sending message to Telegram:', error)
      return []
    }
  }
}
