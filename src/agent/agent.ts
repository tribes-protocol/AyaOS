import { IAyaAgent } from '@/agent/iagent'
import { AgentcoinAPI } from '@/apis/agentcoinfun'
import {
  AYA_OS_AGENT_PATH_RESOLVER,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_LARGE_MODEL,
  DEFAULT_SMALL_MODEL,
  LLM_PROXY,
  WEBSEARCH_PROXY
} from '@/common/constants'
import { AGENTCOIN_FUN_API_URL } from '@/common/env'
import { ensureRuntimeService, isNull, isRequiredString, loadEnvFile } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import { PathResolver } from '@/common/path-resolver'
import { AyaOSOptions } from '@/common/types'
import { ayaPlugin } from '@/plugins/aya'
import { AgentcoinService } from '@/services/agentcoinfun'
import { ConfigService } from '@/services/config'
import { EventService } from '@/services/event'
import { IKnowledgeService, IMemoriesService, IWalletService } from '@/services/interfaces'
import { KeychainService } from '@/services/keychain'
import { KnowledgeService } from '@/services/knowledge'
import { MemoriesService } from '@/services/memories'
import { WalletService } from '@/services/wallet'
import {
  Action,
  AgentRuntime,
  Evaluator,
  Plugin,
  Provider,
  Service,
  UUID,
  type Character
} from '@elizaos/core'
import farcasterPlugin from '@elizaos/plugin-farcaster'
import openaiPlugin from '@elizaos/plugin-openai'
import sqlPlugin from '@elizaos/plugin-sql'
import fs from 'fs'
import path from 'path'

const reservedAgentDirs = new Set<string | undefined>()

export class Agent implements IAyaAgent {
  private services: (typeof Service)[] = []
  private providers: Provider[] = []
  private actions: Action[] = []
  private plugins: Plugin[] = []
  private evaluators: Evaluator[] = []
  private runtime_: AgentRuntime | undefined
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

  get runtime(): AgentRuntime {
    if (!this.runtime_) {
      throw new Error('Runtime not initialized. Call start() first.')
    }
    return this.runtime_
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

  get memories(): IMemoriesService {
    return ensureRuntimeService<MemoriesService>(
      this.runtime,
      MemoriesService.serviceType,
      'Memories service not found'
    )
  }

  get wallet(): IWalletService {
    return ensureRuntimeService<WalletService>(
      this.runtime,
      WalletService.serviceType,
      'Wallet service not found'
    )
  }

  async start(): Promise<void> {
    let runtime: AgentRuntime | undefined

    try {
      console.info('Starting agent...', AGENTCOIN_FUN_API_URL)

      // step 1: provision the hardware if needed.
      const agentcoinAPI = new AgentcoinAPI()
      const agentcoinService = AgentcoinService.getInstance(
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

      const configService = ConfigService.getInstance(eventService, this.pathResolver)

      // step 2: load character and initialize database
      ayaLogger.info('Loading character...')
      const charString = await fs.promises.readFile(this.pathResolver.characterFile, 'utf8')
      const character: Character = JSON.parse(charString)
      if (isNull(character.id)) {
        throw new Error('Character id not found')
      }

      // character.templates = {
      //   ...character.templates,
      //   messageHandlerTemplate: AGENTCOIN_MESSAGE_HANDLER_TEMPLATE
      // }

      const jwtToken = await agentcoinService.getJwtAuthToken()
      character.settings = character.settings || {}

      // setup websearch
      if (isNull(character.settings.TAVILY_API_URL)) {
        character.settings.TAVILY_API_URL = WEBSEARCH_PROXY
      }
      if (character.settings.TAVILY_API_URL === WEBSEARCH_PROXY) {
        character.settings.TAVILY_API_KEY = jwtToken
      }

      // setup llm
      if (isNull(character.settings.OPENAI_BASE_URL)) {
        character.settings.OPENAI_BASE_URL = LLM_PROXY
        character.settings.OPENAI_SMALL_MODEL = DEFAULT_SMALL_MODEL
        character.settings.OPENAI_LARGE_MODEL = DEFAULT_LARGE_MODEL
        character.settings.OPENAI_EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL
        character.settings.OPENAI_EMBEDDING_DIMENSIONS = DEFAULT_EMBEDDING_DIMENSIONS
      }
      if (character.settings.OPENAI_BASE_URL === LLM_PROXY) {
        character.settings.OPENAI_API_KEY = jwtToken
      }

      this.plugins.push(sqlPlugin)
      this.plugins.push(openaiPlugin)

      ayaLogger.info('Creating runtime for character', character.name)

      const settings = fs.existsSync(this.pathResolver.envFile)
        ? loadEnvFile(this.pathResolver.envFile)
        : loadEnvFile(path.join(process.cwd(), '.env'))

      this.processSecrets(settings)

      runtime = new AgentRuntime({
        character,
        plugins: this.plugins,
        agentId: character.id,
        settings
      })

      this.runtime_ = runtime

      runtime.setSetting(AYA_OS_AGENT_PATH_RESOLVER, this.pathResolver)

      KnowledgeService.getInstance(runtime, agentcoinAPI, agentcoinCookie, agentcoinIdentity)
      WalletService.getInstance(
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

          console.log('The End.')
          process.exit(0)
        } catch (error) {
          console.error('Error shutting down:', error)
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

      // register evaluators
      this.evaluators.forEach(runtime.registerEvaluator)

      // register providers
      this.providers.forEach(runtime.registerContextProvider)

      // register actions
      this.actions.forEach(runtime.registerAction)

      // register services

      // register services
      const ayaServices = [
        AgentcoinService,
        ConfigService,
        KnowledgeService,
        MemoriesService,
        WalletService,
        ...this.services
      ]
      for (const service of ayaServices) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        await runtime.registerService(service as typeof Service)
      }

      await this.runtime.registerPlugin(ayaPlugin)
      await this.runtime.registerPlugin(farcasterPlugin)

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

  private processSecrets(env: Record<string, string>): void {
    Object.entries(env).forEach(([key, value]) => {
      if (key.startsWith('AGENTCOIN_ENC_') && isRequiredString(value)) {
        const decryptedValue = this.keychainService.decrypt(value)
        const newKey = key.substring(14)
        ayaLogger.info('Decrypted secret:', newKey)
        env[newKey] = decryptedValue
        delete env[key]
      }
    })
  }
}
