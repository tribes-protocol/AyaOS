import { ensureUUID } from '@/common/functions'
import { RagKnowledgeItemContent } from '@/common/types'
import { Knowledges, Memories } from '@/databases/postgres/schema'
import PostgresDatabaseAdapter from '@elizaos/adapter-postgres'
import { Memory, RAGKnowledgeItem, UUID } from '@elizaos/core'
import { and, cosineDistance, desc, eq, gt, sql } from 'drizzle-orm'
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

export class AyaPostgresDatabaseAdapter extends PostgresDatabaseAdapter {
  drizzleDb: PostgresJsDatabase

  constructor({ connectionString }: { connectionString: string }) {
    super({
      connectionString
    })

    this.drizzleDb = drizzle(
      postgres(connectionString, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10
      })
    )
  }

  async init(): Promise<void> {
    await super.init()
  }

  async searchMemoriesByEmbedding(
    embedding: number[],
    params: {
      match_threshold?: number
      count?: number
      roomId?: UUID
      agentId?: UUID
      unique?: boolean
      tableName: string
    }
  ): Promise<Memory[]> {
    return this.withCircuitBreaker(async () => {
      const similarity = sql<number>`1 - (${cosineDistance(Memories.embedding, embedding)})`

      const conditions = [
        eq(Memories.type, params.tableName),
        sql`${Memories.embedding} IS NOT NULL`
      ]

      if (params.roomId) {
        conditions.push(eq(Memories.roomId, params.roomId))
      }

      if (params.agentId) {
        conditions.push(eq(Memories.agentId, params.agentId))
      }

      if (params.unique !== undefined) {
        conditions.push(eq(Memories.unique, params.unique))
      }

      if (params.match_threshold !== undefined) {
        conditions.push(gt(similarity, params.match_threshold))
      }

      const query = this.drizzleDb
        .select({
          id: Memories.id,
          type: Memories.type,
          createdAt: Memories.createdAt,
          content: Memories.content,
          embedding: Memories.embedding,
          userId: Memories.userId,
          agentId: Memories.agentId,
          roomId: Memories.roomId,
          unique: Memories.unique,
          similarity
        })
        .from(Memories)
        .where(and(...conditions))
        .orderBy(desc(similarity))

      if (params.count !== undefined) {
        query.limit(params.count)
      }

      const results = await query

      return results.map((row) => ({
        id: row.id,
        type: row.type,
        createdAt: row.createdAt?.getTime(),
        content: row.content,
        embedding: row.embedding || undefined,
        userId: row.userId,
        agentId: row.agentId,
        roomId: row.roomId,
        unique: row.unique,
        similarity: row.similarity
      }))
    }, 'searchMemoriesByEmbedding')
  }

  async searchKnowledge(params: {
    agentId: UUID
    embedding: Float32Array
    match_threshold: number
    match_count: number
    searchText?: string
  }): Promise<RAGKnowledgeItem[]> {
    return this.withCircuitBreaker(async () => {
      const {
        agentId,
        embedding,
        match_threshold: matchThreshold,
        match_count: matchCount
      } = params

      // eslint-disable-next-line max-len
      const similarity = sql<number>`1 - (${cosineDistance(Knowledges.embedding, Array.from(embedding))})`

      const results = await this.drizzleDb
        .select({
          id: Knowledges.id,
          agentId: Knowledges.agentId,
          content: Knowledges.content,
          embedding: Knowledges.embedding,
          createdAt: Knowledges.createdAt,
          isMain: Knowledges.isMain,
          originalId: Knowledges.originalId,
          chunkIndex: Knowledges.chunkIndex,
          isShared: Knowledges.isShared,
          similarity
        })
        .from(Knowledges)
        .where(
          and(
            gt(similarity, matchThreshold),
            eq(Knowledges.agentId, agentId),
            eq(Knowledges.isMain, false)
          )
        )
        .orderBy((t) => desc(t.similarity))
        .limit(matchCount)

      return this.convertToRAGKnowledgeItems(results)
    }, 'searchKnowledge')
  }

  private convertToRAGKnowledgeItems(
    results: Array<{
      id: string
      agentId: string | null
      content: RagKnowledgeItemContent
      embedding?: number[] | null
      createdAt?: Date | null
      isMain?: boolean | null
      originalId?: string | null
      chunkIndex?: number | null
      isShared?: boolean | null
      similarity?: number | null
    }>
  ): RAGKnowledgeItem[] {
    return results.map((result) => {
      // Extract content text
      let text = ''
      if (typeof result.content === 'object' && result.content && 'text' in result.content) {
        text = String(result.content.text)
      } else {
        text = JSON.stringify(result.content)
      }

      // Extract or create metadata
      const metadata: Record<string, unknown> = {}

      // Add properties from result
      if (result.isMain !== null && result.isMain !== undefined) {
        metadata.isMain = result.isMain
      }
      if (result.originalId) {
        metadata.originalId = result.originalId
      }
      if (result.chunkIndex !== null && result.chunkIndex !== undefined) {
        metadata.chunkIndex = result.chunkIndex
      }
      if (result.isShared !== null && result.isShared !== undefined) {
        metadata.isShared = result.isShared
      }

      // Add metadata from content if available
      if (
        typeof result.content === 'object' &&
        result.content &&
        'metadata' in result.content &&
        typeof result.content.metadata === 'object' &&
        result.content.metadata
      ) {
        Object.assign(metadata, result.content.metadata)
      }

      const item: RAGKnowledgeItem = {
        id: ensureUUID(result.id),
        agentId: ensureUUID(result.agentId),
        content: {
          text,
          metadata
        },
        ...(result.similarity !== undefined && result.similarity !== null
          ? { similarity: result.similarity }
          : {}),
        ...(result.embedding ? { embedding: new Float32Array(result.embedding) } : {}),
        ...(result.createdAt ? { createdAt: result.createdAt.getTime() } : {})
      }
      return item
    })
  }
}
