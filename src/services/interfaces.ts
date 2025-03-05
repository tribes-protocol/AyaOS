import {
  AgentWallet,
  AgentWalletKind,
  CreateMessage,
  HexString,
  HydratedMessage,
  Identity,
  Transaction,
  User
} from '@/common/types'

import { RagKnowledgeItemContent } from '@/common/schema'
import { RAGKnowledgeItem, UUID } from '@elizaos/core'

export interface IWalletService {
  signPersonalMessage(wallet: AgentWallet, message: string): Promise<string>
  signAndSubmitTransaction(wallet: AgentWallet, transaction: Transaction): Promise<HexString>
  getDefaultWallet(kind: AgentWalletKind): Promise<AgentWallet>
}

export interface IAgentcoinService {
  sendMessage(message: CreateMessage): Promise<HydratedMessage>
  getIdentity(): Promise<Identity>
  getUser(identity: Identity): Promise<User | undefined>
  getCookie(): Promise<string>
  getJwtAuthToken(): Promise<string>
}

export interface IConfigService {
  checkEnvAndCharacterUpdate(): Promise<void>
}

export interface IKnowledgeBaseService {
  list(): Promise<RAGKnowledgeItem[]>
  get(id: UUID): Promise<RAGKnowledgeItem | undefined>
  add(id: UUID, knowledge: RagKnowledgeItemContent): Promise<void>
  remove(id: UUID): Promise<void>
  search(options: {
    q: string
    limit: number
    tag?: string
    matchThreshold?: number
  }): Promise<RAGKnowledgeItem[]>
}
