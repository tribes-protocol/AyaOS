import { ensureUUID, isNull } from '@/common/functions'
import { AyaRuntime } from '@/common/runtime'
import { MemoryFilters, ServiceKind } from '@/common/types'
import { IStoreService, StoreItem } from '@/services/interfaces'
import {
  Content,
  embed as elizaEmbed,
  IAgentRuntime,
  Service,
  ServiceType,
  stringToUuid,
  UUID
} from '@elizaos/core'

export class StoreService extends Service implements IStoreService {
  constructor(private readonly runtime: AyaRuntime) {
    super()
  }

  static get serviceType(): ServiceType {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ServiceKind.store as unknown as ServiceType
  }

  async initialize(_: IAgentRuntime): Promise<void> {}

  async insert(params: {
    table: string
    data: Record<string, unknown>
    embedding?: number[]
  }): Promise<StoreItem> {
    const item: StoreItem = {
      id: crypto.randomUUID(),
      data: params.data,
      embedding: params.embedding
    }

    const roomId = stringToUuid(params.table)

    const room = await this.runtime.databaseAdapter.getRoom(roomId)
    if (isNull(room)) {
      await this.runtime.databaseAdapter.createRoom(roomId)
    }

    await this.runtime.databaseAdapter.createMemory(
      {
        id: item.id,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        content: item.data as unknown as Content,
        embedding: item.embedding,
        createdAt: new Date().getTime(),
        userId: this.runtime.agentId,
        agentId: this.runtime.agentId,
        roomId
      },
      params.table,
      true
    )

    return item
  }

  async searchByEmbedding(params: {
    table: string
    embedding: number[]
    limit: number
    matchThreshold: number
  }): Promise<StoreItem[]> {
    const memories = await this.runtime.databaseAdapter.searchMemoriesByEmbedding(
      params.embedding,
      {
        match_threshold: params.matchThreshold,
        count: params.limit,
        tableName: params.table
      }
    )

    return memories.map((memory) => ({
      id: ensureUUID(memory.id),
      data: memory.content,
      embedding: memory.embedding
    }))
  }

  async filter(params: {
    table: string
    filters: MemoryFilters
    limit?: number
  }): Promise<StoreItem[]> {
    const memories = await this.runtime.databaseAdapter.filterMemories({
      table: params.table,
      filters: params.filters,
      limit: params.limit
    })

    return memories.map((memory) => ({
      id: ensureUUID(memory.id),
      data: memory.content,
      embedding: memory.embedding
    }))
  }

  async delete(params: { table: string; id: UUID }): Promise<void> {
    await this.runtime.databaseAdapter.removeMemory(params.id, params.table)
  }

  async embed(text: string): Promise<number[]> {
    return elizaEmbed(this.runtime, text)
  }
}
