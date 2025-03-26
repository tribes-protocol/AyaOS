import { PathResolver } from '@/common/path-resolver'
import { IAyaDatabaseAdapter } from '@/databases/interfaces'
import {
  ActionExample,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  Service,
  ServiceTypeName,
  State
} from '@elizaos/core'

export type ServiceLike<T> =
  | ServiceTypeName
  | string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | ((new (...args: any[]) => T) & { serviceType: string })

export interface IAyaRuntime extends IAgentRuntime {
  readonly pathResolver: PathResolver

  ensureService<T extends Service>(service: ServiceLike<T>, message?: string): T

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
