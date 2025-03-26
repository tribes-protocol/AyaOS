import { Action, Provider } from '@/common/iruntime'
import { AyaRuntime } from '@/common/runtime'
import { ContextHandler } from '@/common/types'
import {
  IKnowledgeService,
  IMemoriesService,
  IStoreService,
  IWalletService
} from '@/services/interfaces'
import { Plugin, Service, UUID } from '@elizaos/core'

export interface IAyaAgent {
  readonly agentId: UUID
  readonly runtime: AyaRuntime
  readonly knowledge: IKnowledgeService
  readonly memories: IMemoriesService
  readonly wallet: IWalletService
  readonly store: IStoreService

  start(): Promise<void>

  on(event: 'pre:llm', handler: ContextHandler): void
  on(event: 'post:llm', handler: ContextHandler): void
  on(event: 'pre:action', handler: ContextHandler): void
  on(event: 'post:action', handler: ContextHandler): void

  off(event: 'pre:llm', handler: ContextHandler): void
  off(event: 'post:llm', handler: ContextHandler): void
  off(event: 'pre:action', handler: ContextHandler): void
  off(event: 'post:action', handler: ContextHandler): void

  register(kind: 'service', handler: Service): Promise<void>
  register(kind: 'provider', handler: Provider): Promise<void>
  register(kind: 'action', handler: Action): Promise<void>
  register(kind: 'plugin', handler: Plugin): Promise<void>
}
