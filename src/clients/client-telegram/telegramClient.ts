import { getOrCreateRecommenderInBe } from '@/clients/client-telegram/getOrCreateRecommenderInBe'
import { MessageManager } from '@/clients/client-telegram/messageManager'
import { AgentcoinRuntime } from '@/common/runtime'
import { elizaLogger } from '@elizaos/core'
import { type Context, Telegraf } from 'telegraf'

export class TelegramClient {
  private bot: Telegraf<Context>
  private runtime: AgentcoinRuntime
  private messageManager: MessageManager
  private backend
  private backendToken
  private tgTrader
  private options

  constructor(runtime: AgentcoinRuntime, botToken: string) {
    elizaLogger.log('📱 Constructing new TelegramClient...')
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
    elizaLogger.log('✅ TelegramClient constructor completed')
  }

  public async start(): Promise<void> {
    elizaLogger.log('🚀 Starting Telegram bot...')
    try {
      await this.initializeBot()
      this.setupMessageHandlers()
      this.setupShutdownHandlers()
    } catch (error) {
      elizaLogger.error('❌ Failed to launch Telegram bot:', error)
      throw error
    }
  }

  private async initializeBot(): Promise<void> {
    await this.bot.launch({ dropPendingUpdates: true })
    elizaLogger.log('✨ Telegram bot successfully launched and is running!')

    const botInfo = await this.bot.telegram.getMe()
    this.bot.botInfo = botInfo
    elizaLogger.success(`Bot username: @${botInfo.username}`)

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

    const allowedGroups = config.allowedGroupIds || []
    const currentGroupId = ctx.chat.id.toString()

    if (!allowedGroups.includes(currentGroupId)) {
      elizaLogger.info(`Unauthorized group detected: ${currentGroupId}`)
      try {
        await ctx.reply('Not authorized. Leaving.')
        await ctx.leaveChat()
      } catch (error) {
        elizaLogger.error(`Error leaving unauthorized group ${currentGroupId}:`, error)
      }
      return false
    }

    return true
  }

  private setupMessageHandlers(): void {
    elizaLogger.log('Setting up message handler...')

    this.bot.on('message', async (ctx) => {
      try {
        // Check group authorization first
        if (!(await this.isGroupAuthorized(ctx))) {
          return
        }

        if (this.tgTrader) {
          const userId = ctx.from?.id.toString()
          const username = ctx.from?.username || ctx.from?.first_name || 'Unknown'
          if (!userId) {
            elizaLogger.warn('Received message from a user without an ID.')
            return
          }
          try {
            await getOrCreateRecommenderInBe(userId, username, this.backendToken, this.backend)
          } catch (error) {
            elizaLogger.error('Error getting or creating recommender in backend', error)
          }
        }

        await this.messageManager.handleMessage(ctx)
      } catch (error) {
        elizaLogger.error('❌ Error handling message:', error)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (error?.response?.error_code !== 403) {
          try {
            await ctx.reply('An error occurred while processing your message.')
          } catch (replyError) {
            elizaLogger.error('Failed to send error message:', replyError)
          }
        }
      }
    })

    this.bot.on('photo', (ctx) => {
      elizaLogger.log('📸 Received photo message with caption:', ctx.message.caption)
    })

    this.bot.on('document', (ctx) => {
      elizaLogger.log('📎 Received document message:', ctx.message.document.file_name)
    })

    this.bot.catch(async (err, ctx) => {
      elizaLogger.error(`❌ Telegram Error for ${ctx.updateType}:`, err)
      await ctx.reply('An unexpected error occurred. Please try again later.')
    })
  }

  private setupShutdownHandlers(): void {
    const shutdownHandler = async (signal: string): Promise<void> => {
      elizaLogger.log(`⚠️ Received ${signal}. Shutting down Telegram bot gracefully...`)
      try {
        await this.stop()
        elizaLogger.log('🛑 Telegram bot stopped gracefully')
      } catch (error) {
        elizaLogger.error('❌ Error during Telegram bot shutdown:', error)
        throw error
      }
    }

    process.once('SIGINT', () => shutdownHandler('SIGINT'))
    process.once('SIGTERM', () => shutdownHandler('SIGTERM'))
    process.once('SIGHUP', () => shutdownHandler('SIGHUP'))
  }

  public async stop(): Promise<void> {
    elizaLogger.log('Stopping Telegram bot...')
    // await
    this.bot.stop()
    elizaLogger.log('Telegram bot stopped')
  }
}
