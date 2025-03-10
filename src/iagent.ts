import { AgentcoinRuntime } from '@/common/runtime'
import { ContextHandler, Tool } from '@/common/types'
import { IKnowledgeBaseService, IMemoriesService, IWalletService } from '@/services/interfaces'
import { Plugin, Provider, Service, UUID } from '@elizaos/core'

export interface IAyaAgent {
  readonly agentId: UUID
  readonly runtime: AgentcoinRuntime
  readonly knowledge: IKnowledgeBaseService
  readonly memories: IMemoriesService
  readonly wallet: IWalletService
  start(): Promise<void>

  on(event: 'pre:llm', handler: ContextHandler): void
  on(event: 'post:llm', handler: ContextHandler): void
  on(event: 'pre:tool', handler: ContextHandler): void
  on(event: 'post:tool', handler: ContextHandler): void

  off(event: 'pre:llm', handler: ContextHandler): void
  off(event: 'post:llm', handler: ContextHandler): void
  off(event: 'pre:tool', handler: ContextHandler): void
  off(event: 'post:tool', handler: ContextHandler): void

  register(kind: 'service', handler: Service): void
  register(kind: 'provider', handler: Provider): void
  register(kind: 'tool', handler: Tool): void
  register(kind: 'plugin', handler: Plugin): void
}
