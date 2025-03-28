import { ensure, formatKnowledge, isNull } from '@/common/functions'
import { Action, AgentEventHandler, IAyaRuntime, Provider } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import { PathResolver } from '@/common/path-resolver'
import { Context, SdkEventKind } from '@/common/types'
import { IAyaDatabaseAdapter } from '@/databases/interfaces'
import { AyaRAGKnowledgeManager } from '@/managers/rag_knowledge'
import { MemoriesService } from '@/services/memories'
import {
  AgentRuntime,
  Character,
  // eslint-disable-next-line no-restricted-imports
  Action as ElizaAction,
  // eslint-disable-next-line no-restricted-imports
  Provider as ElizaProvider,
  Evaluator,
  generateText,
  ICacheManager,
  IMemoryManager,
  KnowledgeItem,
  Memory,
  ModelClass,
  ModelProviderName,
  Plugin,
  Service,
  ServiceType,
  State,
  UUID
} from '@elizaos/core'
import { z } from 'zod'

const ResponseValidationSchema = z.object({
  valid: z.boolean(),
  correctedResponse: z.string(),
  explanation: z.string()
})

export class AyaRuntime extends AgentRuntime implements IAyaRuntime {
  private eventHandler: AgentEventHandler | undefined
  public readonly pathResolver: PathResolver
  public readonly matchThreshold: number
  public readonly matchLimit: number
  public readonly databaseAdapter: IAyaDatabaseAdapter

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
      databaseAdapter: IAyaDatabaseAdapter
      fetch?: typeof fetch | unknown
      speechModelPath?: string
      cacheManager: ICacheManager
      logging?: boolean
    }
    pathResolver: PathResolver
    matchThreshold?: number
    matchLimit?: number
  }) {
    super({
      ...opts.eliza,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      actions: opts.eliza.actions ? (opts.eliza.actions as ElizaAction[]) : undefined,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      providers: opts.eliza.providers ? (opts.eliza.providers as ElizaProvider[]) : undefined
    })
    this.pathResolver = opts.pathResolver
    this.matchThreshold = opts.matchThreshold ?? 0.4
    this.matchLimit = opts.matchLimit ?? 6
    this.databaseAdapter = opts.eliza.databaseAdapter

    // 😈 hacky way to set the knowledge root
    // eslint-disable-next-line
    ;(this as any).knowledgeRoot = this.pathResolver.knowledgeRoot

    this.ragKnowledgeManager = new AyaRAGKnowledgeManager({
      runtime: this,
      tableName: 'knowledge',
      knowledgeRoot: this.pathResolver.knowledgeRoot
    })
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

      ayaLogger.success(`User ${username} created successfully.`)
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

    // Reset RAG-based properties to empty values
    state.ragKnowledgeData = []
    state.ragKnowledge = ''

    // Get regular memories only
    const memService = this.ensureService(MemoriesService, 'Memories service not found')
    const memItems = await memService.search({
      q: message.content.text,
      limit: this.matchLimit,
      type: 'fragments',
      matchThreshold: this.matchThreshold
    })

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

    if (this.character.system) {
      state.systemPrompt = this.character.system
    }

    return state
  }

  async registerService(service: Service): Promise<void> {
    const serviceType = service.serviceType
    ayaLogger.log(`${this.character.name}(${this.agentId}) - Registering service:`, serviceType)

    if (this.services.has(serviceType)) {
      ayaLogger.warn(
        `${this.character.name}(${this.agentId}) - Service ${serviceType}` +
          ` is already registered. Skipping registration.`
      )
      return
    }

    try {
      await service.initialize(this)
      this.services.set(serviceType, service)
      ayaLogger.success(
        `${this.character.name}(${this.agentId}) - Service ${serviceType} initialized successfully`
      )
    } catch (error) {
      ayaLogger.error(
        `${this.character.name}(${this.agentId}) - Failed to initialize service ${serviceType}:`,
        error
      )
      throw error
    }
  }

  async validateResponse(responseText: string): Promise<string | undefined> {
    if (isNull(this.character.system)) {
      return responseText
    }

    const validationPrompt = `You are a response validator for an AI assistant. 
Your task is to check if the following response strictly adheres to the system rules defined below.

If the response violates ANY of the rules, you must:
1. Return a JSON object with "valid": false and "correctedResponse" containing a polite decline 
   and redirection to appropriate topics
2. The corrected response should maintain the assistant's professional tone while staying 
   within bounds

If the response follows ALL rules, return a JSON with "valid": true and the original "response"

SYSTEM RULES:
${this.character.system}

RESPONSE TO VALIDATE:
${responseText}

Return your analysis as a JSON object with the following structure. Make sure it's the 
raw json. No markdown or anything else:
{
  "valid": boolean,
  "correctedResponse": string // Original response if valid, corrected response if invalid
  "explanation": string // Brief explanation of why the response was invalid (if applicable)
}`

    try {
      console.log('Validating request:', responseText)
      const validationResult = await generateText({
        runtime: this,
        context: validationPrompt,
        modelClass: ModelClass.MEDIUM
      })

      // Try to parse the result up to three times
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const parsed = ResponseValidationSchema.parse(JSON.parse(validationResult))
          const t = parsed.valid ? responseText : parsed.correctedResponse
          console.log('Validated response:', t)
          return t
        } catch (parseError) {
          if (attempt === 2) {
            console.error('Failed to parse validation result after 3 attempts:', parseError)
            return undefined
          }
          // Continue to next attempt
        }
      }

      return undefined
    } catch (error) {
      console.error('Response validation failed:', error)
      return undefined
    }
  }
}
