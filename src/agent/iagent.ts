import { IKnowledgeService, IMemoriesService, IWalletService } from '@/services/interfaces'
import { Action, AgentRuntime, Plugin, Provider, Service, UUID } from '@elizaos/core'

export interface IAyaAgent {
  readonly agentId: UUID
  readonly runtime: AgentRuntime
  readonly knowledge: IKnowledgeService
  readonly memories: IMemoriesService
  readonly wallet: IWalletService

  start(): Promise<void>

  register(kind: 'service', handler: typeof Service): Promise<void>
  register(kind: 'provider', handler: Provider): Promise<void>
  register(kind: 'action', handler: Action): Promise<void>
  register(kind: 'plugin', handler: Plugin): Promise<void>
}
