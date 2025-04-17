// FIXME: hish - this is a hack to make the plugin types work. Once ElizaOS publishes the types,
// delete this file.

declare module '@elizaos/plugin-bootstrap' {
  import { Plugin } from '@elizaos/core'
  const bootstrapPlugin: Plugin
  export default bootstrapPlugin
}

declare module '@elizaos/plugin-sql' {
  import { Plugin } from '@elizaos/core'
  const sqlPlugin: Plugin
  export default sqlPlugin
}

declare module '@elizaos/plugin-farcaster' {
  import { Plugin } from '@elizaos/core'
  const farcasterPlugin: Plugin
  export default farcasterPlugin
}

declare module '@elizaos/plugin-telegram' {
  import { Content, IAgentRuntime, Plugin, Service } from '@elizaos/core'
  // const telegramPlugin: Plugin
  // export default telegramPlugin

  import { Message, Update } from '@telegraf/types'
  import { Context, NarrowedContext, Telegraf } from 'telegraf'

  /**
   * Enum representing different types of media.
   * @enum { string }
   * @readonly
   */
  declare enum MediaType {
    PHOTO = 'photo',
    VIDEO = 'video',
    DOCUMENT = 'document',
    AUDIO = 'audio',
    ANIMATION = 'animation'
  }
  /**
   * Class representing a message manager.
   * @class
   */
  declare class MessageManager {
    bot: Telegraf<Context>
    protected runtime: IAgentRuntime
    /**
     * Constructor for creating a new instance of a BotAgent.
     *
     * @param {Telegraf<Context>} bot - The Telegraf instance used for interacting with the bot
     * platform.
     * @param {IAgentRuntime} runtime - The runtime environment for the agent.
     */
    constructor(bot: Telegraf<Context>, runtime: IAgentRuntime)
    /**
     * Process an image from a Telegram message to extract the image URL and description.
     *
     * @param {Message} message - The Telegram message object containing the image.
     * @returns {Promise<{ description: string } | null>} The description of the processed image
     * or null if no image found.
     */
    processImage(message: Message): Promise<{
      description: string
    } | null>

    /**
     * Sends a message in chunks, handling attachments and splitting the message if necessary
     *
     * @param {Context} ctx - The context object representing the current state of the bot
     * @param {Content} content - The content of the message to be sent
     * @param {number} [replyToMessageId] - The ID of the message to reply to, if any
     * @returns {Promise<Message.TextMessage[]>} - An array of TextMessage objects representing
     * the messages sent
     */
    sendMessageInChunks(
      ctx: Context,
      content: Content,
      replyToMessageId?: number
    ): Promise<Message.TextMessage[]>

    /**
     * Sends media to a chat using the Telegram API.
     *
     * @param {Context} ctx - The context object containing information about the current chat.
     * @param {string} mediaPath - The path to the media to be sent, either a URL or a local file
     *  path.
     * @param {MediaType} type - The type of media being sent (PHOTO, VIDEO, DOCUMENT, AUDIO, or
     *  ANIMATION).
     * @param {string} [caption] - Optional caption for the media being sent.
     *
     * @returns {Promise<void>} A Promise that resolves when the media is successfully sent.
     */
    sendMedia(ctx: Context, mediaPath: string, type: MediaType, caption?: string): Promise<void>
    /**
     * Splits a given text into an array of strings based on the maximum message length.
     *
     * @param {string} text - The text to split into chunks.
     * @returns {string[]} An array of strings with each element representing a chunk of the
     * original text.
     */
    private splitMessage
    /**
     * Handle incoming messages from Telegram and process them accordingly.
     * @param {Context} ctx - The context object containing information about the message.
     * @returns {Promise<void>}
     */
    handleMessage(ctx: Context): Promise<void>
    /**
     * Handles the reaction event triggered by a user reacting to a message.
     * @param {NarrowedContext<Context<Update>, Update.MessageReactionUpdate>} ctx The context
     * of the message reaction update
     * @returns {Promise<void>} A Promise that resolves when the reaction handling is complete
     */
    handleReaction(
      ctx: NarrowedContext<Context<Update>, Update.MessageReactionUpdate>
    ): Promise<void>

    /**
     * Sends a message to a Telegram chat and emits appropriate events
     * @param {number | string} chatId - The Telegram chat ID to send the message to
     * @param {Content} content - The content to send
     * @param {number} [replyToMessageId] - Optional message ID to reply to
     * @returns {Promise<Message.TextMessage[]>} The sent messages
     */
    sendMessage(
      chatId: number | string,
      content: Content,
      replyToMessageId?: number
    ): Promise<Message.TextMessage[]>
  }

  /**
   * Class representing a Telegram service that allows the agent to send and receive messages
   * on Telegram.
   * This service handles all Telegram-specific functionality including:
   * - Initializing and managing the Telegram bot
   * - Setting up middleware for preprocessing messages
   * - Handling message and reaction events
   * - Synchronizing Telegram chats, users, and entities with the agent runtime
   * - Managing forum topics as separate rooms
   *
   * @extends Service
   */
  declare class TelegramService extends Service {
    static serviceType: ServiceType
    capabilityDescription: string
    private bot
    messageManager: MessageManager
    private options
    private knownChats
    private syncedEntityIds
    /**
     * Constructor for TelegramService class.
     * @param {IAgentRuntime} runtime - The runtime object for the agent.
     */
    constructor(runtime: IAgentRuntime)
    /**
     * Starts the Telegram service for the given runtime.
     *
     * @param {IAgentRuntime} runtime - The agent runtime to start the Telegram service for.
     * @returns {Promise<TelegramService>} A promise that resolves with the initialized
     *  TelegramService.
     */
    static start(runtime: IAgentRuntime): Promise<TelegramService>
    /**
     * Stops the agent runtime.
     * @param {IAgentRuntime} runtime - The agent runtime to stop
     */
    static stop(runtime: IAgentRuntime): Promise<void>
    /**
     * Asynchronously stops the bot.
     *
     * @returns A Promise that resolves once the bot has stopped.
     */
    stop(): Promise<void>
    /**
     * Initializes the Telegram bot by launching it, getting bot info, and setting up message
     * manager.
     * @returns {Promise<void>} A Promise that resolves when the initialization is complete.
     */
    private initializeBot
    /**
     * Sets up the middleware chain for preprocessing messages before they reach handlers.
     * This critical method establishes a sequential processing pipeline that:
     *
     * 1. Authorization - Verifies if a chat is allowed to interact with the bot based on configured
     *  settings
     * 2. Chat Discovery - Ensures chat entities and worlds exist in the runtime, creating them
     * if needed
     * 3. Forum Topics - Handles Telegram forum topics as separate rooms for better conversation
     *  management
     * 4. Entity Synchronization - Ensures message senders are properly synchronized as entities
     *
     * The middleware chain runs in sequence for each message, with each step potentially
     * enriching the context or stopping processing if conditions aren't met.
     * This preprocessing is essential for maintaining consistent state before message handlers
     * execute.
     *
     * @private
     */
    private setupMiddlewares
    /**
     * Authorization middleware - checks if chat is allowed to interact with the bot
     * based on the TELEGRAM_ALLOWED_CHATS configuration.
     *
     * @param {Context} ctx - The context of the incoming update
     * @param {Function} next - The function to call to proceed to the next middleware
     * @returns {Promise<void>}
     * @private
     */
    private authorizationMiddleware
    /**
     * Chat and entity management middleware - handles new chats, forum topics, and entity
     *  synchronization.
     * This middleware implements decision logic to determine which operations are needed based on
     * the chat type and whether we've seen this chat before.
     *
     * @param {Context} ctx - The context of the incoming update
     * @param {Function} next - The function to call to proceed to the next middleware
     * @returns {Promise<void>}
     * @private
     */
    private chatAndEntityMiddleware
    /**
     * Process an existing chat based on chat type and message properties.
     * Different chat types require different processing steps.
     *
     * @param {Context} ctx - The context of the incoming update
     * @returns {Promise<void>}
     * @private
     */
    private processExistingChat
    /**
     * Sets up message and reaction handlers for the bot.
     * Configures event handlers to process incoming messages and reactions.
     *
     * @private
     */
    private setupMessageHandlers
    /**
     * Checks if a group is authorized, based on the TELEGRAM_ALLOWED_CHATS setting.
     * @param {Context} ctx - The context of the incoming update.
     * @returns {Promise<boolean>} A Promise that resolves with a boolean indicating if the
     * group is authorized.
     */
    private isGroupAuthorized
    /**
     * Synchronizes an entity from a message context with the runtime system.
     * This method handles three cases:
     * 1. Message sender - most common case
     * 2. New chat member - when a user joins the chat
     * 3. Left chat member - when a user leaves the chat
     *
     * @param {Context} ctx - The context of the incoming update
     * @returns {Promise<void>}
     * @private
     */
    private syncEntity
    /**
     * Synchronizes the message sender entity with the runtime system.
     * This is the most common entity sync case.
     *
     * @param {Context} ctx - The context of the incoming update
     * @param {UUID} worldId - The ID of the world
     * @param {UUID} roomId - The ID of the room
     * @param {string} chatId - The ID of the chat
     * @returns {Promise<void>}
     * @private
     */
    private syncMessageSender
    /**
     * Synchronizes a new chat member entity with the runtime system.
     * Triggered when a user joins the chat.
     *
     * @param {Context} ctx - The context of the incoming update
     * @param {UUID} worldId - The ID of the world
     * @param {UUID} roomId - The ID of the room
     * @param {string} chatId - The ID of the chat
     * @returns {Promise<void>}
     * @private
     */
    private syncNewChatMember
    /**
     * Updates entity status when a user leaves the chat.
     *
     * @param {Context} ctx - The context of the incoming update
     * @returns {Promise<void>}
     * @private
     */
    private syncLeftChatMember
    /**
     * Handles forum topics by creating appropriate rooms in the runtime system.
     * This enables proper conversation management for Telegram's forum feature.
     *
     * @param {Context} ctx - The context of the incoming update
     * @returns {Promise<void>}
     * @private
     */
    private handleForumTopic
    /**
     * Builds entity for message sender
     */
    private buildMsgSenderEntity
    /**
     * Handles new chat discovery and emits WORLD_JOINED event.
     * This is a critical function that ensures new chats are properly
     * registered in the runtime system and appropriate events are emitted.
     *
     * @param {Context} ctx - The context of the incoming update
     * @returns {Promise<void>}
     * @private
     */
    private handleNewChat
    /**
     * Processes entities in batches to prevent overwhelming the system.
     *
     * @param {Entity[]} entities - The entities to process
     * @param {UUID} roomId - The ID of the room to connect entities to
     * @param {string} channelId - The channel ID
     * @param {string} serverId - The server ID
     * @param {ChannelType} roomType - The type of the room
     * @param {UUID} worldId - The ID of the world
     * @returns {Promise<void>}
     * @private
     */
    private batchProcessEntities
    /**
     * Gets chat title and channel type based on Telegram chat type.
     * Maps Telegram-specific chat types to standardized system types.
     *
     * @param {any} chat - The Telegram chat object
     * @returns {Object} Object containing chatTitle and channelType
     * @private
     */
    private getChatTypeInfo
    /**
     * Builds standardized entity representations from Telegram chat data.
     * Transforms Telegram-specific user data into system-standard Entity objects.
     *
     * @param {any} chat - The Telegram chat object
     * @returns {Promise<Entity[]>} Array of standardized Entity objects
     * @private
     */
    private buildStandardizedEntities
    /**
     * Extracts and builds the room object for a forum topic from a message context.
     * This refactored method can be used both in middleware and when handling new chats.
     *
     * @param {Context} ctx - The context of the incoming update
     * @param {UUID} worldId - The ID of the world the topic belongs to
     * @returns {Promise<Room | null>} A Promise that resolves with the room or null if not a topic
     * @private
     */
    private buildForumTopicRoom
  }

  declare const telegramPlugin: Plugin

  export { telegramPlugin as default, MessageManager, TelegramService }
}
