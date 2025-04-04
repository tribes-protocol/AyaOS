import { IAyaAgent } from '@/agent/iagent'
import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { LLM_PROXY, WEBSEARCH_PROXY } from '@/common/constants'
import { AGENTCOIN_FUN_API_URL } from '@/common/env'
import { isNull, isRequiredString, loadEnvFile } from '@/common/functions'
import { Action, Plugin, Provider } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import { PathResolver } from '@/common/path-resolver'
import { AyaRuntime } from '@/common/runtime'
import { AyaOSOptions } from '@/common/types'
import ayaPlugin from '@/plugins/aya'
import openaiPlugin from '@/plugins/openai'
import webSearchPlugin from '@/plugins/webSearch'
import { AgentcoinService } from '@/services/agentcoinfun'
import { ConfigService } from '@/services/config'
import { EventService } from '@/services/event'
import { IKnowledgeService, IMemoriesService, IWalletService } from '@/services/interfaces'
import { KeychainService } from '@/services/keychain'
import { KnowledgeService } from '@/services/knowledge'
import { MemoriesService } from '@/services/memories'
import { WalletService } from '@/services/wallet'
import { AGENTCOIN_MESSAGE_HANDLER_TEMPLATE } from '@/templates/message'
import {
  // eslint-disable-next-line no-restricted-imports
  Action as ElizaAction,
  // eslint-disable-next-line no-restricted-imports
  Provider as ElizaProvider,
  Evaluator,
  Service,
  UUID,
  type Character
} from '@elizaos/core'
import farcasterPlugin from '@elizaos/plugin-farcaster'
import fs from 'fs'
import path from 'path'

const reservedAgentDirs = new Set<string | undefined>()

export class Agent implements IAyaAgent {
  private services: (typeof Service)[] = []
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
    return this.runtime.ensureService<KnowledgeService>(
      KnowledgeService.serviceType,
      'Knowledge base service not found'
    )
  }

  get memories(): IMemoriesService {
    return this.runtime.ensureService<MemoriesService>(
      MemoriesService.serviceType,
      'Memories service not found'
    )
  }

  get wallet(): IWalletService {
    return this.runtime.ensureService<WalletService>(
      WalletService.serviceType,
      'Wallet service not found'
    )
  }

  async start(): Promise<void> {
    let runtime: AyaRuntime | undefined

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

      character.templates = {
        ...character.templates,
        messageHandlerTemplate: AGENTCOIN_MESSAGE_HANDLER_TEMPLATE
      }

      const jwtToken = await agentcoinService.getJwtAuthToken()

      if (character.settings?.OPENAI_BASE_URL === LLM_PROXY) {
        character.settings.OPENAI_API_KEY = jwtToken
      }

      if (character.settings?.TAVILY_API_URL === WEBSEARCH_PROXY) {
        character.settings.TAVILY_API_KEY = jwtToken
      }

      this.plugins.push(openaiPlugin)
      this.plugins.push(webSearchPlugin)

      ayaLogger.info('Creating runtime for character', character.name)

      const settings = fs.existsSync(this.pathResolver.envFile)
        ? loadEnvFile(this.pathResolver.envFile)
        : loadEnvFile(path.join(process.cwd(), '.env'))

      this.processSecrets(settings)

      runtime = new AyaRuntime({
        eliza: {
          character,
          plugins: this.plugins,
          agentId: character.id,
          settings
        },
        pathResolver: this.pathResolver
      })

      this.runtime_ = runtime

      KnowledgeService.getInstance(
        runtime,
        agentcoinAPI,
        agentcoinCookie,
        agentcoinIdentity,
        this.pathResolver
      )
      WalletService.getInstance(
        agentcoinCookie,
        agentcoinIdentity,
        agentcoinAPI,
        runtime,
        this.keychainService.turnkeyApiKeyStamper
      )

      // register default models
      // runtime.registerModel(ModelType.TEXT_EMBEDDING, async (params: { text: string }) => {
      //   if (isNull(this.embeddingsConfig)) {
      //     throw new Error('Embeddings config not found')
      //   }

      //   if (isNull(params.text) || params.text.length === 0) {
      //     console.warn('Text is null or empty, returning empty embedding')
      //     return Array(this.embeddingsConfig.dimensions).fill(0)
      //   }

      //   const embedding = await embed(params.text, this.embeddingsConfig)
      //   return embedding
      // })
      // runtime.registerModel(ModelType.OBJECT_LARGE, async (params: { text: string }) => {
      //   if (isNull(this.embeddingsConfig)) {
      //     throw new Error('Embeddings config not found')
      //   }
      // })

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
      for (const evaluator of this.evaluators) {
        runtime.registerEvaluator(evaluator)
      }

      // register providers
      for (const provider of this.providers) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        runtime.registerContextProvider(provider as ElizaProvider)
      }

      // register actions
      for (const action of this.actions) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        runtime.registerAction(action as ElizaAction)
      }

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
