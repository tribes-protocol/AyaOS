import { IAyaAgent } from '@/agent/iagent'
import {
  AYA_AGENT_DATA_DIR_KEY,
  AYA_AGENT_IDENTITY_KEY,
  AYA_JWT_SETTINGS_KEY,
  CHARACTERS_DIR,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_LARGE_MODEL,
  DEFAULT_SMALL_MODEL,
  LLM_PROXY,
  OPENAI_API_KEY,
  PGLITE_DATA_DIR,
  WEBSEARCH_PROXY
} from '@/common/constants'
import { AGENTCOIN_FUN_API_URL } from '@/common/env'
import {
  ensureRuntimeService,
  ensureUUID,
  isNull,
  isRequiredString,
  loadEnvFile
} from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import { AuthInfo, AyaOSOptions, CharacterSchema } from '@/common/types'
import { ayaPlugin } from '@/plugins/aya'
import { IKnowledgeService, IWalletService } from '@/services/interfaces'
import { KnowledgeService } from '@/services/knowledge'
import { WalletService } from '@/services/wallet'
import {
  Action,
  AgentRuntime,
  Evaluator,
  IAgentRuntime,
  logger,
  ModelTypeName,
  Plugin,
  Provider,
  Service,
  ServiceTypeName,
  UUID,
  type Character
} from '@elizaos/core'
// import farcasterPlugin from '@elizaos/plugin-farcaster'
import { AgentContext, AgentRegistry } from '@/agent/registry'
import { ITelegramManager } from '@/managers/interfaces'
import { TelegramManager } from '@/managers/telegram'
import openaiPlugin from '@/plugins/openai'
import sqlPlugin from '@elizaos/plugin-sql'
import telegramPlugin from '@elizaos/plugin-telegram'
import fs from 'fs'
import path from 'path'

export class Agent implements IAyaAgent {
  private services: (typeof Service)[] = []
  private providers: Provider[] = []
  private actions: Action[] = []
  private plugins: Plugin[] = []
  private evaluators: Evaluator[] = []
  private runtime_: AgentRuntime | undefined
  private context_?: AgentContext
  private telegram_?: ITelegramManager

  constructor(readonly options?: AyaOSOptions) {}

  get runtime(): AgentRuntime {
    if (!this.runtime_) {
      throw new Error('Runtime not initialized. Call start() first.')
    }
    return this.runtime_
  }

  get context(): AgentContext {
    if (!this.context_) {
      throw new Error('Context not initialized. Call start() first.')
    }
    return this.context_
  }

  get agentId(): UUID {
    return this.runtime.agentId
  }

  get knowledge(): IKnowledgeService {
    return ensureRuntimeService<KnowledgeService>(
      this.runtime,
      KnowledgeService.serviceType,
      'Knowledge base service not found'
    )
  }

  get wallet(): IWalletService {
    return ensureRuntimeService<WalletService>(
      this.runtime,
      WalletService.serviceType,
      'Wallet service not found'
    )
  }

  get telegram(): ITelegramManager {
    if (isNull(this.telegram_)) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      this.telegram_ = new TelegramManager(this.runtime.getService('telegram' as ServiceTypeName))
    }
    return this.telegram_
  }

  async start(): Promise<void> {
    let runtime: AgentRuntime | undefined

    try {
      logger.info('Starting agent...', AGENTCOIN_FUN_API_URL)

      // step 1: provision the hardware if needed.
      const context = await AgentRegistry.setup(this.options)
      this.context_ = context
      const { auth, managers } = context

      const envSettings = this.processSettings()

      // step 2: load character and initialize database
      const character = await this.setupCharacter(auth, envSettings)

      // step 3: initialize required plugins
      this.plugins.push(sqlPlugin)
      this.plugins.push(openaiPlugin)

      // step 4: initialize environment variables and runtime
      runtime = new AgentRuntime({
        character,
        plugins: this.plugins,
        agentId: character.id,
        settings: envSettings
      })

      this.runtime_ = runtime

      // shutdown handler
      let isShuttingDown = false
      const shutdown = async (signal?: string): Promise<void> => {
        try {
          if (isShuttingDown) {
            return
          }
          isShuttingDown = true

          ayaLogger.warn(`Received ${signal} signal. Stopping agent...`)

          if (runtime) {
            try {
              const agentId = runtime.agentId
              ayaLogger.warn('Stopping agent runtime...', agentId)
              await runtime.stop()
              await AgentRegistry.destroy(this.context.dataDir)
              ayaLogger.success('Agent runtime stopped successfully!', agentId)
            } catch (error) {
              ayaLogger.error('Error stopping agent:', error)
            }
          }

          logger.info('The End.')
          process.exit(0)
        } catch (error) {
          logger.error('Error shutting down:', error)
          process.exit(1)
        }
      }

      managers.config.setShutdownFunc(shutdown)

      process.once('SIGINT', () => {
        void shutdown('SIGINT')
      })
      process.once('SIGTERM', () => {
        void shutdown('SIGTERM')
      })

      // initialize the runtime
      await this.runtime.initialize()

      // register evaluators
      this.evaluators.forEach(runtime.registerEvaluator.bind(runtime))

      // register providers
      this.providers.forEach(runtime.registerContextProvider.bind(runtime))

      // register actions
      this.actions.forEach(runtime.registerAction.bind(runtime))

      // register services
      const ayaServices: (typeof Service)[] = [KnowledgeService, WalletService, ...this.services]
      for (const service of ayaServices) {
        await hackRegisterService(service, this.runtime)
      }

      await hackRegisterPlugin(ayaPlugin, this.runtime)
      // await hackRegisterPlugin(farcasterPlugin, this.runtime)
      const TELEGRAM_BOT_TOKEN =
        this.runtime.getSetting('TELEGRAM_BOT_TOKEN') || process.env.TELEGRAM_BOT_TOKEN
      if (TELEGRAM_BOT_TOKEN) {
        await hackRegisterPlugin(telegramPlugin, this.runtime)
      }

      // start the managers
      const AGENTCOIN_MONITORING_ENABLED = this.runtime.getSetting('AGENTCOIN_MONITORING_ENABLED')

      if (AGENTCOIN_MONITORING_ENABLED) {
        ayaLogger.info('Agentcoin monitoring enabled')
        await managers.config.start()
      }

      ayaLogger.info(`Started ${this.runtime.character.name} as ${this.runtime.agentId}`)
    } catch (error: unknown) {
      console.log('sdk error', error)
      ayaLogger.error(
        'Error creating agent:',
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              cause: error.cause
            }
          : String(error)
      )
      throw error
    }

    ayaLogger.success('agent runtime started id:', runtime.agentId, 'name', runtime.character.name)

    const agentUrl = `${AGENTCOIN_FUN_API_URL}/agent/${this.context.auth.identity}`
    // Calculate box width based on URL length
    const boxWidth = Math.max(70, agentUrl.length + 6)

    // Print a fancy bordered URL message
    console.log('\n┌' + '─'.repeat(boxWidth) + '┐')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + '  🚀 Your agent is ready!  '.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + '  Visit your agent at:'.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + `  ${agentUrl}`.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('└' + '─'.repeat(boxWidth) + '┘\n')
  }

  async register(kind: 'service', handler: typeof Service): Promise<void>
  async register(kind: 'provider', handler: Provider): Promise<void>
  async register(kind: 'action', handler: Action): Promise<void>
  async register(kind: 'plugin', handler: Plugin): Promise<void>
  async register(kind: 'evaluator', handler: Evaluator): Promise<void>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async register(kind: string, handler: any): Promise<void> {
    switch (kind) {
      case 'service':
        this.services.push(handler)
        if (this.runtime_) {
          await this.runtime.registerService(handler)
        }
        break
      case 'action':
        this.actions.push(handler)
        if (this.runtime_) {
          this.runtime.registerAction(handler)
        }
        break
      case 'provider':
        this.providers.push(handler)
        if (this.runtime_) {
          this.runtime.registerContextProvider(handler)
        }
        break
      case 'plugin':
        this.plugins.push(handler)
        if (this.runtime_) {
          this.runtime.plugins.push(handler)
        }
        break
      case 'evaluator':
        this.evaluators.push(handler)
        if (this.runtime_) {
          this.runtime.registerEvaluator(handler)
        }
        break
      default:
        throw new Error(`Unknown registration kind: ${kind}`)
    }
  }

  private async setupCharacter(
    authInfo: AuthInfo,
    envSettings: Record<string, string>
  ): Promise<Character> {
    logger.info('Loading character...')
    const { identity, token } = authInfo

    const characterId = ensureUUID(identity.substring(6))
    const characterFile = path.join(CHARACTERS_DIR, `${characterId}.character.json`)

    const charString = await fs.promises.readFile(characterFile, 'utf8')
    const character = CharacterSchema.parse(JSON.parse(charString))
    if (isNull(character.id)) {
      throw new Error('Character id not found')
    }

    character.secrets = character.secrets || {}

    // setup ayaos token
    character.secrets[AYA_JWT_SETTINGS_KEY] = token
    character.secrets[AYA_AGENT_IDENTITY_KEY] = identity
    character.secrets[AYA_AGENT_DATA_DIR_KEY] = this.context.dataDir

    // setup websearch
    if (isNull(character.secrets.TAVILY_API_URL)) {
      character.secrets.TAVILY_API_URL = WEBSEARCH_PROXY
    }
    if (character.secrets.TAVILY_API_URL === WEBSEARCH_PROXY) {
      character.secrets.TAVILY_API_KEY = token
    }

    const openaiApiKey = this.getConfigValue(character, envSettings, OPENAI_API_KEY)

    // setup llm
    if (isNull(openaiApiKey) || openaiApiKey.trim() === '') {
      character.secrets.OPENAI_BASE_URL = LLM_PROXY
      character.secrets.OPENAI_SMALL_MODEL = DEFAULT_SMALL_MODEL
      character.secrets.OPENAI_LARGE_MODEL = DEFAULT_LARGE_MODEL
      character.secrets.OPENAI_EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL
      character.secrets.OPENAI_EMBEDDING_DIMENSIONS = DEFAULT_EMBEDDING_DIMENSIONS
      character.secrets.OPENAI_API_KEY = token
    }

    const isPgliteDataDirSet = !isNull(this.getConfigValue(character, envSettings, PGLITE_DATA_DIR))

    if (!isPgliteDataDirSet) {
      character.secrets.PGLITE_DATA_DIR = path.join(this.context.dataDir, 'elizadb')
    }

    logger.info('loaded character', character.name)

    return character
  }

  private getConfigValue(
    character: Character,
    envSettings: Record<string, string>,
    key: string
  ): string | undefined {
    return (
      character.secrets?.[key] ||
      character.settings?.[key] ||
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      character.settings?.secrets?.[key] ||
      envSettings[key] ||
      process.env[key]
    )
  }

  private processSettings(): Record<string, string> {
    const env = fs.existsSync(this.context.managers.path.envFile)
      ? loadEnvFile(this.context.managers.path.envFile)
      : loadEnvFile(path.join(process.cwd(), '.env'))

    Object.entries(env).forEach(([key, value]) => {
      if (key.startsWith('AGENTCOIN_ENC_') && isRequiredString(value)) {
        const decryptedValue = this.context.managers.keychain.decrypt(value)
        const newKey = key.substring(14)
        ayaLogger.info('Decrypted secret:', newKey)
        env[newKey] = decryptedValue
        delete env[key]
      }
    })

    return env
  }
}

// FIXME: hish - delete this function after my fix goes into elizaos/core

async function hackRegisterPlugin(plugin: Plugin, runtime: IAgentRuntime): Promise<void> {
  if (!plugin) {
    console.error('*** registerPlugin plugin is undefined')
    throw new Error('*** registerPlugin plugin is undefined')
  }

  // Add to plugins array if not already present - but only if it was not passed there initially
  // (otherwise we can't add to readonly array)
  if (!runtime.plugins.some((p) => p.name === plugin.name)) {
    // Push to plugins array - this works because we're modifying the array, not reassigning it
    runtime.plugins.push(plugin)
    logger.info(`Success: Plugin ${plugin.name} registered successfully`)
  }

  // Initialize the plugin if it has an init function
  if (plugin.init) {
    try {
      await plugin.init(plugin.config || {}, runtime)
      logger.info(`Success: Plugin ${plugin.name} initialized successfully`)
    } catch (error) {
      // Check if the error is related to missing API keys
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (
        errorMessage.includes('API key') ||
        errorMessage.includes('environment variables') ||
        errorMessage.includes('Invalid plugin configuration')
      ) {
        // Instead of throwing an error, log a friendly message
        logger.warn(`Plugin ${plugin.name} requires configuration. ${errorMessage}`)
        logger.warn(
          'Please check your environment variables and ensure all required API keys are set.'
        )
        logger.warn('You can set these in your .eliza/.env file.')

        // We don't throw here, allowing the application to continue
        // with reduced functionality
      } else {
        // For other types of errors, rethrow
        throw error
      }
    }
  }

  // Register plugin adapter
  if (plugin.adapter) {
    logger.info(`Registering database adapter for plugin ${plugin.name}`)
    runtime.registerDatabaseAdapter(plugin.adapter)
  }

  // Register plugin actions
  if (plugin.actions) {
    for (const action of plugin.actions) {
      runtime.registerAction(action)
    }
  }

  // Register plugin evaluators
  if (plugin.evaluators) {
    for (const evaluator of plugin.evaluators) {
      runtime.registerEvaluator(evaluator)
    }
  }

  // Register plugin providers
  if (plugin.providers) {
    for (const provider of plugin.providers) {
      runtime.registerProvider(provider)
    }
  }

  // Register plugin models
  if (plugin.models) {
    for (const [modelType, handler] of Object.entries(plugin.models)) {
      // eslint-disable-next-line max-len
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
      runtime.registerModel(modelType as ModelTypeName, handler as (params: any) => Promise<any>)
    }
  }

  // Register plugin routes
  if (plugin.routes) {
    for (const route of plugin.routes) {
      runtime.routes.push(route)
    }
  }

  // Register plugin events
  if (plugin.events) {
    for (const [eventName, eventHandlers] of Object.entries(plugin.events)) {
      for (const eventHandler of eventHandlers) {
        runtime.registerEvent(eventName, eventHandler)
      }
    }
  }

  if (plugin.services) {
    for (const service of plugin.services) {
      await hackRegisterService(service, runtime)
    }
  }
}

async function hackRegisterService(service: typeof Service, runtime: IAgentRuntime): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const serviceType = service.serviceType as ServiceTypeName
  if (!serviceType) {
    return
  }

  if (runtime.services.has(serviceType)) {
    logger.warn(`(${runtime.agentId}) - Service ${serviceType} is already registered.`)
    return
  }

  const serviceInstance = await service.start(runtime)
  // Add the service to the services map
  runtime.services.set(serviceType, serviceInstance)
  logger.info(`(${runtime.agentId}) - Service ${serviceType} registered successfully`)
}
