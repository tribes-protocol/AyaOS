import { Action, Provider } from '@/common/iruntime'
import { AyaRuntime } from '@/common/runtime'
import { IKnowledgeService, IMemoriesService, IWalletService } from '@/services/interfaces'
import { Plugin, Service, UUID } from '@elizaos/core'

export interface IAyaAgent {
  readonly agentId: UUID
  readonly runtime: AyaRuntime
  readonly knowledge: IKnowledgeService
  readonly memories: IMemoriesService
  readonly wallet: IWalletService

  start(): Promise<void>

  register(kind: 'service', handler: typeof Service): Promise<void>
  register(kind: 'provider', handler: Provider): Promise<void>
  register(kind: 'action', handler: Action): Promise<void>
  register(kind: 'plugin', handler: Plugin): Promise<void>
}
