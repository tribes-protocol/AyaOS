import {
  AgentWallet,
  AgentWalletKind,
  CreateMessage,
  HexString,
  HydratedMessage,
  Identity,
  RagKnowledgeItemContent,
  Transaction,
  User
} from '@/common/types'

import { Memory, RAGKnowledgeItem, UUID } from '@elizaos/core'

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
  checkCharacterUpdate(): Promise<void>
}

export interface IKnowledgeService {
  list(options: {
    limit?: number
    sort?: 'asc' | 'desc'
    filters?: {
      isChunk?: boolean
      source?: string
      kind?: string
    }
  }): Promise<RAGKnowledgeItem[]>
  get(id: UUID): Promise<RAGKnowledgeItem | undefined>
  add(id: UUID, knowledge: RagKnowledgeItemContent): Promise<void>
  remove(id: UUID): Promise<void>
  search(options: {
    q: string
    limit: number
    matchThreshold?: number
  }): Promise<RAGKnowledgeItem[]>
}

export interface IMemoriesService {
  search(options: {
    q: string
    limit: number
    type: string
    matchThreshold?: number
  }): Promise<Memory[]>
}

export interface StoreItem {
  id: UUID
  data: Record<string, unknown>
  embedding?: number[]
}

export interface IStoreService {
  insert(params: {
    table: string
    data: Record<string, unknown>
    embedding?: number[]
  }): Promise<StoreItem>
  searchByEmbedding(params: {
    table: string
    embedding: number[]
    limit: number
    matchThreshold: number
  }): Promise<StoreItem[]>
  filter(params: {
    table: string
    filters: Record<string, unknown>
    limit?: number
  }): Promise<StoreItem[]>
  delete(params: { table: string; id: string }): Promise<void>
  embed(text: string): Promise<number[]>
}
