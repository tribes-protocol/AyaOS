import { ensure, formatKnowledge, isNull } from '@/common/functions'
import { AgentEventHandler, IAyaRuntime } from '@/common/iruntime'
import { PathResolver } from '@/common/path-resolver'
import { Context, SdkEventKind } from '@/common/types'
import { KnowledgeService } from '@/services/knowledge'
import { MemoriesService } from '@/services/memories'
import {
  Action,
  AgentRuntime,
  Character,
  elizaLogger,
  Evaluator,
  ICacheManager,
  IDatabaseAdapter,
  IMemoryManager,
  KnowledgeItem,
  Memory,
  ModelProviderName,
  Plugin,
  Provider,
  Service,
  ServiceType,
  State,
  UUID
} from '@elizaos/core'

export class AyaRuntime extends AgentRuntime implements IAyaRuntime {
  private eventHandler: AgentEventHandler | undefined
  public pathResolver: PathResolver
  public matchThreshold: number
  public matchLimit: number

  public constructor(opts: {
    eliza: {
      conversationLength?: number
      agentId?: UUID
      character?: Character
      token: string
      serverUrl?: string
      actions?: Action[]
      evaluators?: Evaluator[]
      plugins?: Plugin[]
      providers?: Provider[]
      modelProvider: ModelProviderName
      services?: Service[]
      managers?: IMemoryManager[]
      databaseAdapter: IDatabaseAdapter
      fetch?: typeof fetch | unknown
      speechModelPath?: string
      cacheManager: ICacheManager
      logging?: boolean
    }
    pathResolver: PathResolver
    matchThreshold?: number
    matchLimit?: number
  }) {
    super(opts.eliza)
    this.pathResolver = opts.pathResolver
    this.matchThreshold = opts.matchThreshold ?? 0.4
    this.matchLimit = opts.matchLimit ?? 6
  }

  async initialize(options?: { eventHandler: AgentEventHandler }): Promise<void> {
    await super.initialize()

    if (!isNull(this.eventHandler)) {
      throw new Error('AgentcoinRuntime already initialized')
    }

    if (isNull(options?.eventHandler)) {
      throw new Error('AgentcoinRuntime event handler not provided')
    }

    this.eventHandler = options.eventHandler
  }

  async handle(event: SdkEventKind, params: Context): Promise<boolean> {
    if (isNull(this.eventHandler)) {
      throw new Error('AgentcoinRuntime not initialized')
    }

    return this.eventHandler(event, params)
  }

  getService<T extends Service>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service: ServiceType | string | ((new (...args: any[]) => T) & { serviceType: ServiceType })
  ): T | null {
    if (typeof service === 'function') {
      // Handle case where a class constructor is passed
      const serviceType = service.serviceType
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return super.getService(serviceType) as T
    }
    // Handle existing case where ServiceType or string is passed
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return super.getService(service as ServiceType) as T
  }

  ensureSetting(key: string, message?: string): string {
    return ensure(super.getSetting(key), message)
  }

  ensureService<T extends Service>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service: ServiceType | string | ((new (...args: any[]) => T) & { serviceType: ServiceType }),
    message?: string
  ): T {
    return ensure(this.getService(service), message)
  }

  async ensureUserRoomConnection(options: {
    roomId: UUID
    userId: UUID
    username?: string
    name?: string
    email?: string
    source?: string
    image?: string
    bio?: string
    ethAddress?: string
  }): Promise<void> {
    const { roomId, userId, username, name, email, source, image, bio, ethAddress } = options

    await Promise.all([
      this.ensureAccountExists({
        userId: this.agentId,
        username: this.character.username ?? 'Agent',
        name: this.character.name ?? 'Agent',
        email: this.character.email ?? 'Agent',
        source
      }),
      this.ensureAccountExists({
        userId,
        username: username ?? 'User' + userId,
        name: name ?? 'User' + userId,
        email,
        source,
        image,
        bio,
        ethAddress
      }),
      this.ensureRoomExists(roomId)
    ])

    await Promise.all([
      this.ensureParticipantInRoom(userId, roomId),
      this.ensureParticipantInRoom(this.agentId, roomId)
    ])
  }

  async ensureAccountExists(params: {
    userId: UUID
    username: string
    name: string
    email?: string | null
    source?: string | null
    image?: string | null
    bio?: string | null
    ethAddress?: string | null
  }): Promise<void> {
    const { userId, username, name, email, source, image, bio, ethAddress } = params
    const account = await this.databaseAdapter.getAccountById(userId)
    if (isNull(account)) {
      await this.databaseAdapter.createAccount({
        id: userId,
        name,
        username,
        email: email || undefined,
        avatarUrl: image || undefined,
        details: { bio, source, ethAddress }
      })

      elizaLogger.success(`User ${username} created successfully.`)
    }
  }

  async composeState(
    message: Memory,
    additionalKeys?: {
      [key: string]: unknown
    }
  ): Promise<State> {
    const state = await super.composeState(message, additionalKeys)

    // don't do anything if the message is from the agent to itself
    if (message.userId === this.agentId) {
      return state
    }

    // Since ElizaOS rag knowledge is currently broken on postgres adapter, we're just going
    // to override the knowledge state with our own kb service results
    const kbService = this.ensureService(KnowledgeService, 'Knowledge base service not found')
    const memService = this.ensureService(MemoriesService, 'Memories service not found')
    // Run both searches in parallel
    const [kbItems, memItems] = await Promise.all([
      kbService.search({
        q: message.content.text,
        limit: this.matchLimit,
        matchThreshold: this.matchThreshold
      }),
      memService.search({
        q: message.content.text,
        limit: this.matchLimit,
        type: 'fragments',
        matchThreshold: this.matchThreshold
      })
    ])

    // Set RAG knowledge from kbService
    state.ragKnowledgeData = kbItems
    state.ragKnowledge = formatKnowledge(kbItems).trim()

    // Set regular knowledge from memService
    const knowledgeItems: KnowledgeItem[] = memItems
      .map((item) => {
        if (isNull(item.id)) {
          return undefined
        }
        return {
          id: item.id,
          content: item.content
        }
      })
      .filter((item) => !isNull(item))
    state.knowledge = formatKnowledge(knowledgeItems).trim()
    state.knowledgeData = knowledgeItems

    return state
  }

  async registerService(service: Service): Promise<void> {
    const serviceType = service.serviceType
    elizaLogger.log(`${this.character.name}(${this.agentId}) - Registering service:`, serviceType)

    if (this.services.has(serviceType)) {
      elizaLogger.warn(
        `${this.character.name}(${this.agentId}) - Service ${serviceType}` +
          ` is already registered. Skipping registration.`
      )
      return
    }

    try {
      await service.initialize(this)
      this.services.set(serviceType, service)
      elizaLogger.success(
        `${this.character.name}(${this.agentId}) - Service ${serviceType} initialized successfully`
      )
    } catch (error) {
      elizaLogger.error(
        `${this.character.name}(${this.agentId}) - Failed to initialize service ${serviceType}:`,
        error
      )
      throw error
    }
  }
}
