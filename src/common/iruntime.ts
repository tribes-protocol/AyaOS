import { PathResolver } from '@/common/path-resolver'
import { Context, SdkEventKind } from '@/common/types'
import { IAyaDatabaseAdapter } from '@/databases/interfaces'
import {
  ActionExample,
  Character,
  Content,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  Service,
  ServiceType,
  State
} from '@elizaos/core'
import { UUID } from 'crypto'

export type AgentEventHandler = (event: SdkEventKind, params: Context) => Promise<boolean>

export interface IAyaRuntime extends IAgentRuntime {
  readonly agentId: UUID
  readonly character: Character
  readonly pathResolver: PathResolver

  initialize(options?: { eventHandler: AgentEventHandler }): Promise<void>

  handle(event: SdkEventKind, params: Context): Promise<boolean>

  getService<T extends Service>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service: ServiceType | string | ((new (...args: any[]) => T) & { serviceType: ServiceType })
  ): T | null

  ensureService<T extends Service>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service: ServiceType | string | ((new (...args: any[]) => T) & { serviceType: ServiceType }),
    message?: string
  ): T

  validateResponse(params: {
    context: string
    response: Content
    requestText: string
  }): Promise<Content | undefined>

  ensureUserRoomConnection(options: {
    roomId: UUID
    userId: UUID
    username?: string
    name?: string
    email?: string
    source?: string
    image?: string
    bio?: string
    ethAddress?: string
  }): Promise<void>

  ensureAccountExists(params: {
    userId: UUID
    username: string
    name: string
    email?: string | null
    source?: string | null
    image?: string | null
    bio?: string | null
    ethAddress?: string | null
  }): Promise<void>

  composeState(
    message: Memory,
    additionalKeys?: {
      [key: string]: unknown
    }
  ): Promise<State>

  registerService(service: Service): Promise<void>

  ensureSetting(key: string, message?: string): string

  databaseAdapter: IAyaDatabaseAdapter
}

export type Client = {
  /** Start client connection */
  start: (runtime: IAyaRuntime) => Promise<unknown>
  /** Stop client connection */
  stop: (runtime: IAyaRuntime) => Promise<unknown>
}

export type Handler = (
  runtime: IAyaRuntime,
  message: Memory,
  state?: State,
  options?: {
    [key: string]: unknown
  },
  callback?: HandlerCallback
) => Promise<unknown>

export type Validator = (runtime: IAyaRuntime, message: Memory, state?: State) => Promise<boolean>

export interface Action {
  /** Similar action descriptions */
  similes: string[]
  /** Detailed description */
  description: string
  /** Example usages */
  examples: ActionExample[][]
  /** Handler function */
  handler: Handler
  /** Action name */
  name: string
  /** Validation function */
  validate: Validator
  /** Whether to suppress the initial message when this action is used */
  suppressInitialMessage?: boolean
}

export interface Provider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (runtime: IAyaRuntime, message: Memory, state?: State) => Promise<any>
}
