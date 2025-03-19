import { AyaRuntime } from '@/common/runtime'
import { ContextHandler } from '@/common/types'
import { IKnowledgeBaseService, IMemoriesService, IWalletService } from '@/services/interfaces'
import { Action, Plugin, Provider, Service, UUID } from '@elizaos/core'

export interface IAyaAgent {
  readonly agentId: UUID
  readonly runtime: AyaRuntime
  readonly knowledge: IKnowledgeBaseService
  readonly memories: IMemoriesService
  readonly wallet: IWalletService

  start(): Promise<void>

  on(event: 'pre:llm', handler: ContextHandler): void
  on(event: 'post:llm', handler: ContextHandler): void
  on(event: 'pre:action', handler: ContextHandler): void
  on(event: 'post:action', handler: ContextHandler): void

  off(event: 'pre:llm', handler: ContextHandler): void
  off(event: 'post:llm', handler: ContextHandler): void
  off(event: 'pre:action', handler: ContextHandler): void
  off(event: 'post:action', handler: ContextHandler): void

  register(kind: 'service', handler: Service): void
  register(kind: 'provider', handler: Provider): void
  register(kind: 'action', handler: Action): void
  register(kind: 'plugin', handler: Plugin): void
}
