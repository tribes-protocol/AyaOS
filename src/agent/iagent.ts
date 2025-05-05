import { IFarcasterManager, ITelegramManager } from '@/managers/interfaces'
import { IKnowledgeService, ILLMService, IWalletService } from '@/services/interfaces'
import { Action, AgentRuntime, Character, Plugin, Provider, Service, UUID } from '@elizaos/core'

export interface IAyaAgent {
  readonly agentId: UUID
  readonly runtime: AgentRuntime
  readonly knowledge: IKnowledgeService
  readonly wallet: IWalletService
  readonly llm: ILLMService
  readonly character: Character
  readonly telegram: ITelegramManager
  readonly farcaster: IFarcasterManager

  start(): Promise<void>

  register(kind: 'service', handler: typeof Service): Promise<void>
  register(kind: 'provider', handler: Provider): Promise<void>
  register(kind: 'action', handler: Action): Promise<void>
  register(kind: 'plugin', handler: Plugin): Promise<void>
}
