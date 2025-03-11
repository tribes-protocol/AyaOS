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

  on(event: 'llm:pre', handler: ContextHandler): void
  on(event: 'llm:post', handler: ContextHandler): void
  on(event: 'tool:pre', handler: ContextHandler): void
  on(event: 'tool:post', handler: ContextHandler): void

  off(event: 'llm:pre', handler: ContextHandler): void
  off(event: 'llm:post', handler: ContextHandler): void
  off(event: 'tool:pre', handler: ContextHandler): void
  off(event: 'tool:post', handler: ContextHandler): void

  register(kind: 'service', handler: Service): void
  register(kind: 'provider', handler: Provider): void
  register(kind: 'tool', handler: Tool): void
  register(kind: 'plugin', handler: Plugin): void
}
