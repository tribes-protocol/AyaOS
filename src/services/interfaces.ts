import {
  AgentWallet,
  AgentWalletKind,
  HexString,
  RAGKnowledgeItem,
  RagKnowledgeItemContent,
  Transaction
} from '@/common/types'

import { Memory, UUID } from '@elizaos/core'
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
