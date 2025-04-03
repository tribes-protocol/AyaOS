import { PathResolver } from '@/common/path-resolver'
import {
  ActionExample,
  Evaluator,
  EventHandler,
  EventPayload,
  EventPayloadMap,
  HandlerCallback,
  IAgentRuntime,
  IDatabaseAdapter,
  Memory,
  ProviderResult,
  Route,
  Service,
  ServiceTypeName,
  State,
  TestSuite
} from '@elizaos/core'

export type ServiceLike = ServiceTypeName | string

export interface IAyaRuntime extends IAgentRuntime {
  readonly pathResolver: PathResolver

  ensureService<T extends Service>(service: ServiceLike, message?: string): T

  ensureSetting(key: string, message?: string): string

  // registerService(service: typeof Service): void
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
  similes?: string[]
  /** Detailed description */
  description: string
  /** Example usages */
  examples?: ActionExample[][]
  /** Handler function */
  handler: Handler
  /** Action name */
  name: string
  /** Validation function */
  validate: Validator
}

export interface Provider {
  /** Provider name */
  name: string
  /** Description of the provider */
  description?: string
  /** Whether the provider is dynamic */
  dynamic?: boolean
  /** Position of the provider in the provider list, positive or negative */
  position?: number
  /**
   * Whether the provider is private
   *
   * Private providers are not displayed in the regular provider list, they have to be
   * called explicitly
   */
  private?: boolean
  /** Data retrieval function */
  get: (runtime: IAyaRuntime, message: Memory, state: State) => Promise<ProviderResult>
}

export interface Plugin {
  name: string
  description: string
  init?: (config: Record<string, string>, runtime: IAgentRuntime) => Promise<void>
  config?: {
    [key: string]: unknown
  }
  services?: (typeof Service)[]
  componentTypes?: {
    name: string
    schema: Record<string, unknown>
    validator?: (data: unknown) => boolean
  }[]
  actions?: Action[]
  providers?: Provider[]
  evaluators?: Evaluator[]
  adapter?: IDatabaseAdapter
  models?: {
    [key: string]: (...args: unknown[]) => Promise<unknown>
  }
  events?: {
    [K in keyof EventPayloadMap]?: EventHandler<K>[]
  } & {
    [key: string]: ((params: EventPayload) => Promise<unknown>)[]
  }
  routes?: Route[]
  tests?: TestSuite[]
}
