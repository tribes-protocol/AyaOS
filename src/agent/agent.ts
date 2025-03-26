import { IAyaAgent } from '@/agent/iagent'
import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { getTokenForProvider } from '@/common/config'
import { isNull } from '@/common/functions'
import { Action, Provider } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import { PathResolver } from '@/common/path-resolver'
import { AyaRuntime } from '@/common/runtime'
import { AyaOSOptions, ModelConfig } from '@/common/types'
import { initializeDatabase } from '@/databases/db'
import agentcoinPlugin from '@/plugins/agentcoin'
import { AgentcoinService } from '@/services/agentcoinfun'
import { ConfigService } from '@/services/config'
import { EventService } from '@/services/event'
import { IKnowledgeService, IMemoriesService, IWalletService } from '@/services/interfaces'
import { KeychainService } from '@/services/keychain'
import { KnowledgeService } from '@/services/knowledge'
import { MemoriesService } from '@/services/memories'
import { WalletService } from '@/services/wallet'
import { AGENTCOIN_MESSAGE_HANDLER_TEMPLATE } from '@/templates/message'
import { Evaluator, logger, Plugin, Service, UUID, type Character } from '@elizaos/core'
import { bootstrapPlugin } from '@elizaos/plugin-bootstrap'
import fs from 'fs'

const reservedAgentDirs = new Set<string | undefined>()

export class Agent implements IAyaAgent {
  private modelConfig?: ModelConfig
  private services: Service[] = []
  private providers: Provider[] = []
  private actions: Action[] = []
  private plugins: Plugin[] = []
  private evaluators: Evaluator[] = []
  private runtime_: AyaRuntime | undefined
  private pathResolver: PathResolver
  private keychainService: KeychainService

  constructor(options?: AyaOSOptions) {
    if (reservedAgentDirs.has(options?.dataDir)) {
      throw new Error('Data directory already used. Please provide a unique data directory.')
    }
    reservedAgentDirs.add(options?.dataDir)
    this.pathResolver = new PathResolver(options?.dataDir)
    this.keychainService = new KeychainService(this.pathResolver.keypairFile)
  }

  get runtime(): AyaRuntime {
    if (!this.runtime_) {
      throw new Error('Runtime not initialized. Call start() first.')
    }
    return this.runtime_
  }

  get agentId(): UUID {
    return this.runtime.agentId
  }

  get knowledge(): IKnowledgeService {
    return this.runtime.ensureService(KnowledgeService, 'Knowledge base service not found')
  }

  get memories(): IMemoriesService {
    return this.runtime.ensureService(MemoriesService, 'Memories service not found')
  }

  get wallet(): IWalletService {
    return this.runtime.ensureService(WalletService, 'Wallet service not found')
  }

  async start(): Promise<void> {
    let runtime: AyaRuntime | undefined

    try {
      ayaLogger.info('Starting agent...')

      // step 1: provision the hardware if needed.
      const agentcoinAPI = new AgentcoinAPI()
      const agentcoinService = new AgentcoinService(
        this.keychainService,
        agentcoinAPI,
        this.pathResolver
      )
      await agentcoinService.provisionIfNeeded()

      // eagerly start event service
      const agentcoinCookie = await agentcoinService.getCookie()
      const agentcoinIdentity = await agentcoinService.getIdentity()
      const eventService = new EventService(agentcoinCookie, agentcoinAPI)
      void eventService.start()

      const configService = new ConfigService(eventService, this.pathResolver)

      // step 2: load character and initialize database
      ayaLogger.info('Loading character...')
      const [db, charString] = await Promise.all([
        initializeDatabase(this.pathResolver.dbFile),
        fs.promises.readFile(this.pathResolver.characterFile, 'utf8')
      ])

      const character: Character = this.processCharacterSecrets(JSON.parse(charString))
      if (isNull(character.id)) {
        throw new Error('Character id not found')
      }

      const modelConfig = this.modelConfig
      character.templates = {
        ...character.templates,
        messageHandlerTemplate: AGENTCOIN_MESSAGE_HANDLER_TEMPLATE
      }

      if (modelConfig) {
        character.modelProvider = modelConfig.provider
        character.modelEndpointOverride = modelConfig.endpoint
        character.settings = character.settings ?? {}
        character.settings.modelConfig = modelConfig
      }

      // Set elizaLogger to debug mode
      // ayaLogger.level = 'debug'
      // ayaLogger.debug('Logger set to debug mode')

      const token = modelConfig?.apiKey ?? getTokenForProvider(character.modelProvider, character)
      if (isNull(token)) {
        throw new Error('AI API key not found')
      }

      ayaLogger.info('Creating runtime for character', character.name)

      runtime = new AyaRuntime({
        eliza: {
          adapter: db,
          token,
          modelProvider: character.modelProvider,
          evaluators: [...this.evaluators],
          character,
          plugins: [bootstrapPlugin, agentcoinPlugin, ...this.plugins],
          providers: [...this.providers],
          actions: [...this.actions],
          services: [agentcoinService, configService, ...this.services],
          managers: [],
          agentId: character.id
        },
        pathResolver: this.pathResolver,
        matchThreshold: this.matchThreshold,
        matchLimit: this.matchLimit
      })
      this.runtime_ = runtime

      const knowledgeService = new KnowledgeService(
        runtime,
        agentcoinAPI,
        agentcoinCookie,
        agentcoinIdentity
      )
      const memoriesService = new MemoriesService(runtime)
      const walletService = new WalletService(
        agentcoinCookie,
        agentcoinIdentity,
        agentcoinAPI,
        runtime,
        this.keychainService.turnkeyApiKeyStamper
      )

      // shutdown handler
      let isShuttingDown = false
      const shutdown = async (signal?: string): Promise<void> => {
        try {
          if (isShuttingDown) {
            return
          }
          isShuttingDown = true

          ayaLogger.warn(`Received ${signal} signal. Stopping agent...`)
          await Promise.all([configService.stop(), eventService.stop(), knowledgeService.stop()])
          ayaLogger.success('Agent stopped services successfully!')

          if (runtime) {
            try {
              const agentId = runtime.agentId
              ayaLogger.warn('Stopping agent runtime...', agentId)
              await runtime.stop()
              ayaLogger.success('Agent runtime stopped successfully!', agentId)
            } catch (error) {
              ayaLogger.error('Error stopping agent:', error)
            }
          }

          logger.success('The End.')
          process.exit(0)
        } catch (error) {
          logger.error('Error shutting down:', error)
          process.exit(1)
        }
      }

      configService.setShutdownFunc(shutdown)

      process.once('SIGINT', () => {
        void shutdown('SIGINT')
      })
      process.once('SIGTERM', () => {
        void shutdown('SIGTERM')
      })

      // initialize the runtime
      await this.runtime.initialize()

      await Promise.all([
        this.register('service', knowledgeService),
        this.register('service', memoriesService),
        this.register('service', walletService)
      ])
      // no need to await these. it'll lock up the main process
      void Promise.all([configService.start(), knowledgeService.start()])

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
  }

  async register(kind: 'service', handler: Service): Promise<void>
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

  private processCharacterSecrets(character: Character): Character {
    Object.entries(character.settings?.secrets || {}).forEach(([key, value]) => {
      if (key.startsWith('AGENTCOIN_ENC_') && value) {
        const decryptedValue = this.keychainService.decrypt(value)
        const newKey = key.substring(14)
        ayaLogger.info('Decrypted secret', newKey)
        if (character.settings && character.settings.secrets) {
          character.settings.secrets[newKey] = decryptedValue
        }
      }
    })

    return character
  }
}
