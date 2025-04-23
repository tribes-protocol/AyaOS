import {
  AgentWallet,
  AgentWalletKind,
  HexString,
  RAGKnowledgeItem,
  RagKnowledgeItemContent,
  Transaction
} from '@/common/types'
import { TextGenerationParams, UUID } from '@elizaos/core'
import { WalletClient } from 'viem'

export interface IWalletService {
  signPersonalMessage(wallet: AgentWallet, message: string): Promise<string>
  signAndSubmitTransaction(params: {
    client: WalletClient
    transaction: Transaction
  }): Promise<HexString>
  getDefaultWallet(kind: AgentWalletKind): Promise<AgentWallet>
}

export interface IKnowledgeService {
  list(options?: {
    limit?: number
    sort?: 'asc' | 'desc'
    filters?: {
      kind?: string
    }
  }): Promise<{ items: RAGKnowledgeItem[]; nextCursor?: number }>
  get(id: UUID): Promise<RAGKnowledgeItem | undefined>
  add(id: UUID, knowledge: RagKnowledgeItemContent): Promise<void>
  remove(id: UUID): Promise<void>
  search(options: {
    q: string
    limit?: number
    kind?: string
    matchThreshold?: number
  }): Promise<RAGKnowledgeItem[]>
}

export interface ILLMService {
  generateText(options: Omit<TextGenerationParams, 'runtime' | 'model'>): Promise<string>
  generateEmbedding(text: string): Promise<number[]>
}
