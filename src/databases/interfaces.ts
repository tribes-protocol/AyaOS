import { IDatabaseAdapter, IDatabaseCacheAdapter, RAGKnowledgeItem, UUID } from '@elizaos/core'

export interface FetchKnowledgeParams {
  agentId: UUID
  limit?: number
  cursor?: string
  sort?: 'asc' | 'desc'
  filters?: {
    isChunk?: boolean
    source?: string
    kind?: string
  }
}

export interface IAyaDatabaseAdapter extends IDatabaseCacheAdapter, IDatabaseAdapter {
  init(): Promise<void>
  fetchKnowledge(
    params: FetchKnowledgeParams
  ): Promise<{ results: RAGKnowledgeItem[]; cursor?: string }>
}
