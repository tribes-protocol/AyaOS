import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { initializeClients } from '@/clients'
import { getTokenForProvider } from '@/common/config'
import { initializeDatabase } from '@/common/db'
import { AgentcoinRuntime } from '@/common/runtime'
import { Context, ContextHandler, SdkEventKind, Tool } from '@/common/types'
import { IAyaAgent } from '@/iagent'
import agentcoinPlugin from '@/plugins/agentcoin'
import { AgentcoinService } from '@/services/agentcoinfun'
import { ConfigService } from '@/services/config'
import { EventService } from '@/services/event'
import { IKnowledgeBaseService, IMemoriesService, IWalletService } from '@/services/interfaces'
import { KeychainService } from '@/services/keychain'
import { KnowledgeBaseService } from '@/services/knowledge-base'
import { MemoriesService } from '@/services/memories'
import { ProcessService } from '@/services/process'
import { WalletService } from '@/services/wallet'
import {
  CacheManager,
  DbCacheAdapter,
  elizaLogger,
  Evaluator,
  Plugin,
  Provider,
  Service,
  UUID,
  type Character
} from '@elizaos/core'
import { bootstrapPlugin } from '@elizaos/plugin-bootstrap'
import { createNodePlugin } from '@elizaos/plugin-node'
import fs from 'fs'
import { PathManager } from '@/services/paths'
import { ensureUUID } from '@/common/functions'

export class Agent implements IAyaAgent {
  private preLLMHandlers: ContextHandler[] = []
  private postLLMHandlers: ContextHandler[] = []
  private preActionHandlers: ContextHandler[] = []
  private postActionHandlers: ContextHandler[] = []
  private services: Service[] = []
  private providers: Provider[] = []
  private tools: Tool[] = []
  private plugins: Plugin[] = []
  private evaluators: Evaluator[] = []
  private runtime_: AgentcoinRuntime | undefined
  private pathManager: PathManager

  get runtime(): AgentcoinRuntime {
    if (!this.runtime_) {
      throw new Error('Runtime not initialized. Call start() first.')
    }
    return this.runtime_
  }

  get agentId(): UUID {
    return this.runtime.agentId
  }

  get knowledge(): IKnowledgeBaseService {
    return this.runtime.getService(KnowledgeBaseService)
  }

  get memories(): IMemoriesService {
    return this.runtime.getService(MemoriesService)
  }

  get wallet(): IWalletService {
    return this.runtime.getService(WalletService)
  }

  constructor(baseDir?: string) {
    this.pathManager = new PathManager(baseDir)
  }

  async start(): Promise<void> {
    let runtime: AgentcoinRuntime | undefined

    try {
      elizaLogger.info('Starting agent...')

      // step 1: provision the hardware if needed.
      const keychainService = new KeychainService(this.pathManager.KEYPAIR_FILE)
      const agentcoinAPI = new AgentcoinAPI()
      const agentcoinService = new AgentcoinService(keychainService, agentcoinAPI, this.pathManager)
      await agentcoinService.provisionIfNeeded()

      // eagerly start event service
      const agentcoinCookie = await agentcoinService.getCookie()
      const agentcoinIdentity = await agentcoinService.getIdentity()
      const eventService = new EventService(agentcoinCookie, agentcoinAPI)
      void eventService.start()

      const walletService = new WalletService(
        agentcoinCookie,
        agentcoinIdentity,
        agentcoinAPI,
        keychainService.turnkeyApiKeyStamper
      )
      const processService = new ProcessService()
      const configService = new ConfigService(eventService, processService, this.pathManager)

      // step 2: load character and initialize database
      elizaLogger.info('Loading character...')
      const [db, charString] = await Promise.all([
        initializeDatabase(),
        fs.promises.readFile(this.pathManager.CHARACTER_FILE, 'utf8')
      ])

      const agentId = ensureUUID((await agentcoinService.getIdentity()).substring(6))

      const character: Character = JSON.parse(charString)
      character.id = agentId

      const token = getTokenForProvider(character.modelProvider, character)
      const cache = new CacheManager(new DbCacheAdapter(db, character.id))

      elizaLogger.info(elizaLogger.successesTitle, 'Creating runtime for character', character.name)

      runtime = new AgentcoinRuntime({
        eliza: {
          databaseAdapter: db,
          token,
          modelProvider: character.modelProvider,
          evaluators: [...this.evaluators],
          character,
          plugins: [bootstrapPlugin, createNodePlugin(), agentcoinPlugin, ...this.plugins],
          providers: [...this.providers],
          actions: [...this.tools],
          services: [agentcoinService, walletService, configService, ...this.services],
          managers: [],
          cacheManager: cache,
          agentId: character.id
        },
        pathManager: this.pathManager
      })
      this.runtime_ = runtime

      const knowledgeBaseService = new KnowledgeBaseService(runtime)
      const memoriesService = new MemoriesService(runtime)

      // shutdown handler
      let isShuttingDown = false
      const shutdown = async (signal?: string): Promise<void> => {
        try {
          if (isShuttingDown) {
            return
          }
          isShuttingDown = true

          elizaLogger.warn(`Received ${signal} signal. Stopping agent...`)
          await Promise.all([configService.stop(), eventService.stop()])
          // , knowledgeService.stop()])
          elizaLogger.success('Agent stopped services successfully!')

          if (runtime) {
            try {
              const agentId = runtime.agentId
              elizaLogger.warn('Stopping agent runtime...', agentId)
              await runtime.stop()
              elizaLogger.success('Agent runtime stopped successfully!', agentId)
            } catch (error) {
              elizaLogger.error('Error stopping agent:', error)
            }
          }

          elizaLogger.success('The End.')
          process.exit(0)
        } catch (error) {
          elizaLogger.error('Error shutting down:', error)
          elizaLogger.success('The End.')
          process.exit(1)
        }
      }

      processService.setShutdownFunc(shutdown)

      process.once('SIGINT', () => {
        void shutdown('SIGINT')
      })
      process.once('SIGTERM', () => {
        void shutdown('SIGTERM')
      })

      // initialize the runtime
      await this.runtime.initialize({
        eventHandler: (event, params) => this.handle(event, params)
      })

      this.runtime.clients = await initializeClients(this.runtime.character, this.runtime)
      this.register('service', knowledgeBaseService)
      this.register('service', memoriesService)

      // no need to await these. it'll lock up the main process
      // void knowledgeService.start()
      void configService.start()

      elizaLogger.info(`Started ${this.runtime.character.name} as ${this.runtime.agentId}`)
    } catch (error: unknown) {
      console.log('sdk error', error)
      elizaLogger.error(
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

    elizaLogger.success(
      'agent runtime started id:',
      runtime.agentId,
      'name',
      runtime.character.name
    )
  }

  register(kind: 'service', handler: Service): void
  register(kind: 'provider', handler: Provider): void
  register(kind: 'tool', handler: Tool): void
  register(kind: 'plugin', handler: Plugin): void
  register(kind: 'evaluator', handler: Evaluator): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(kind: string, handler: any): void {
    switch (kind) {
      case 'service':
        this.services.push(handler)
        if (this.runtime_) {
          void this.runtime.registerService(handler)
        }
        break
      case 'tool':
        this.tools.push(handler)
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

  on(event: 'llm:pre', handler: ContextHandler): void
  on(event: 'llm:post', handler: ContextHandler): void
  on(event: 'tool:pre', handler: ContextHandler): void
  on(event: 'tool:post', handler: ContextHandler): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: any): void {
    switch (event) {
      case 'llm:pre':
        this.preLLMHandlers.push(handler)
        break
      case 'llm:post':
        this.postLLMHandlers.push(handler)
        break
      case 'tool:pre':
        this.preActionHandlers.push(handler)
        break
      case 'tool:post':
        this.postActionHandlers.push(handler)
        break
      default:
        throw new Error(`Unknown event: ${event}`)
    }
  }

  off(event: 'llm:pre', handler: ContextHandler): void
  off(event: 'llm:post', handler: ContextHandler): void
  off(event: 'tool:pre', handler: ContextHandler): void
  off(event: 'tool:post', handler: ContextHandler): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, handler: any): void {
    switch (event) {
      case 'llm:pre':
        this.preLLMHandlers = this.preLLMHandlers.filter((h) => h !== handler)
        break
      case 'llm:post':
        this.postLLMHandlers = this.postLLMHandlers.filter((h) => h !== handler)
        break
      case 'tool:pre':
        this.preActionHandlers = this.preActionHandlers.filter((h) => h !== handler)
        break
      case 'tool:post':
        this.postActionHandlers = this.postActionHandlers.filter((h) => h !== handler)
        break
      default:
        throw new Error(`Unknown event: ${event}`)
    }
  }

  private async handle(event: SdkEventKind, params: Context): Promise<boolean> {
    switch (event) {
      case 'llm:pre': {
        for (const handler of this.preLLMHandlers) {
          const shouldContinue = await handler(params)
          if (!shouldContinue) return false
        }
        break
      }

      case 'llm:post': {
        for (const handler of this.postLLMHandlers) {
          const shouldContinue = await handler(params)
          if (!shouldContinue) return false
        }
        break
      }

      case 'tool:pre': {
        for (const handler of this.preActionHandlers) {
          const shouldContinue = await handler(params)
          if (!shouldContinue) return false
        }
        break
      }

      case 'tool:post': {
        for (const handler of this.postActionHandlers) {
          const shouldContinue = await handler(params)
          if (!shouldContinue) return false
        }
        break
      }
    }

    return true
  }
}
