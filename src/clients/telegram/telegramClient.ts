import { getOrCreateRecommenderInBe } from '@/clients/telegram/getOrCreateRecommenderInBe'
import { MessageManager } from '@/clients/telegram/messageManager'
import { isNull } from '@/common/functions'
import { Client, IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import { ITelegramManager } from '@/services/interfaces'
import { Content } from '@elizaos/core'
import { type Context, Telegraf } from 'telegraf'

interface TelegramError {
  response?: {
    error_code: number
  }
}

function isTelegramError(error: unknown): error is TelegramError {
  return typeof error === 'object' && error !== null && 'response' in error
}

export class TelegramClient implements Client, ITelegramManager {
  private bot: Telegraf<Context>
  private runtime: IAyaRuntime
  private messageManager: MessageManager
  private backend: string | null
  private backendToken: string | null
  private tgTrader: string | null
  private options?: Partial<Telegraf.Options<Context>>

  constructor(runtime: IAyaRuntime, botToken: string) {
    ayaLogger.info('📱 Constructing new TelegramClient...')
    this.options = {
      telegram: {
        apiRoot:
          runtime.getSetting('TELEGRAM_API_ROOT') ||
          process.env.TELEGRAM_API_ROOT ||
          'https://api.telegram.org'
      }
    }
    this.runtime = runtime
    this.bot = new Telegraf(botToken, this.options)
    this.messageManager = new MessageManager(this.bot, this.runtime)
    this.backend = runtime.getSetting('BACKEND_URL')
    this.backendToken = runtime.getSetting('BACKEND_TOKEN')
    this.tgTrader = runtime.getSetting('TG_TRADER') // boolean To Be added to the settings
    ayaLogger.info('✅ TelegramClient constructor completed')
  }

  async sendMessage(params: {
    chatId: number | string
    content: Content
    replyToMessage?: number | string
  }): Promise<number> {
    const message = await this.messageManager.sendMessage(params)
    return message.message_id
  }

  public async start(runtime: IAyaRuntime): Promise<void> {
    if (this.runtime.agentId !== runtime.agentId) {
      throw new Error('Telegram client runtime mismatch')
    }

    ayaLogger.info('🚀 Starting Telegram bot...')
    try {
      await this.initializeBot()
      this.setupMessageHandlers()
      this.setupShutdownHandlers()
    } catch (error) {
      ayaLogger.error('❌ Failed to launch Telegram bot:', error)
      throw error
    }
  }

  private async initializeBot(): Promise<void> {
    void this.bot.launch({ dropPendingUpdates: true })
    ayaLogger.info('✨ Telegram bot successfully launched and is running!')

    const botInfo = await this.bot.telegram.getMe()
    this.bot.botInfo = botInfo
    ayaLogger.success(`Bot username: @${botInfo.username}`)

    this.messageManager.bot = this.bot
  }

  private async isGroupAuthorized(ctx: Context): Promise<boolean> {
    const config = this.runtime.character.clientConfig?.telegram
    if (ctx.from?.id === ctx.botInfo?.id) {
      return false
    }

    if (!config?.shouldOnlyJoinInAllowedGroups) {
      return true
    }

    if (isNull(ctx.chat?.id)) {
      throw new Error('Chat ID is not defined')
    }

    const allowedGroups = config.allowedGroupIds || []
    const currentGroupId = ctx.chat.id.toString()

    if (!allowedGroups.includes(currentGroupId)) {
      ayaLogger.info(`Unauthorized group detected: ${currentGroupId}`)
      try {
        await ctx.reply('Not authorized. Leaving.')
        await ctx.leaveChat()
      } catch (error) {
        ayaLogger.error(`Error leaving unauthorized group ${currentGroupId}:`, error)
      }
      return false
    }

    return true
  }

  private setupMessageHandlers(): void {
    ayaLogger.info('Setting up message handler...')

    this.bot.on('message', async (ctx) => {
      try {
        // Check group authorization first
        if (!(await this.isGroupAuthorized(ctx))) {
          return
        }

        if (this.tgTrader && this.backendToken && this.backend) {
          const userId = ctx.from?.id.toString()
          const username = ctx.from?.username || ctx.from?.first_name || 'Unknown'
          if (!userId) {
            ayaLogger.warn('Received message from a user without an ID.')
            return
          }
          try {
            await getOrCreateRecommenderInBe(userId, username, this.backendToken, this.backend)
          } catch (error) {
            ayaLogger.error('Error getting or creating recommender in backend', error)
          }
        }

        await this.messageManager.handleMessage(ctx)
      } catch (error: unknown) {
        ayaLogger.error('❌ Error handling message:', error)
        if (isTelegramError(error) && error.response?.error_code !== 403) {
          try {
            await ctx.reply('An error occurred while processing your message.')
          } catch (replyError) {
            ayaLogger.error('Failed to send error message:', replyError)
          }
        }
      }
    })

    this.bot.on('photo', (ctx) => {
      ayaLogger.info('📸 Received photo message with caption:', ctx.message.caption)
    })

    this.bot.on('document', (ctx) => {
      ayaLogger.info('📎 Received document message:', ctx.message.document.file_name)
    })

    this.bot.catch(async (err, ctx) => {
      console.error(`❌ Telegram Error for ${ctx.updateType}:`, err)

      // we should not reply to the user here if error
      // await ctx.reply('An unexpected error occurred. Please try again later.')
    })
  }

  private setupShutdownHandlers(): void {
    const shutdownHandler = async (signal: string): Promise<void> => {
      ayaLogger.info(`⚠️ Received ${signal}. Shutting down Telegram bot gracefully...`)
      try {
        await this.stop(this.runtime)
        ayaLogger.info('🛑 Telegram bot stopped gracefully')
      } catch (error) {
        ayaLogger.error('❌ Error during Telegram bot shutdown:', error)
        throw error
      }
    }

    process.once('SIGINT', () => shutdownHandler('SIGINT'))
    process.once('SIGTERM', () => shutdownHandler('SIGTERM'))
    process.once('SIGHUP', () => shutdownHandler('SIGHUP'))
  }

  public async stop(runtime: IAyaRuntime): Promise<void> {
    if (this.runtime.agentId !== runtime.agentId) {
      throw new Error('Telegram client runtime mismatch')
    }

    ayaLogger.info('Stopping Telegram bot...')
    // await
    this.bot.stop()
    ayaLogger.info('Telegram bot stopped')
  }
}
