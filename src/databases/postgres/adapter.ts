import { ensureUUID } from '@/common/functions'
import { RagKnowledgeItemContent } from '@/common/types'
import { FetchKnowledgeParams, IAyaDatabaseAdapter } from '@/databases/interfaces'
import { Knowledges, Memories } from '@/databases/postgres/schema'
import PostgresDatabaseAdapter from '@elizaos/adapter-postgres'
import { Memory, RAGKnowledgeItem, UUID } from '@elizaos/core'
import { and, cosineDistance, desc, eq, gt, sql } from 'drizzle-orm'
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

export class AyaPostgresDatabaseAdapter
  extends PostgresDatabaseAdapter
  implements IAyaDatabaseAdapter
{
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

    // Create indexes on JSON properties for better query performance
    await this.createJsonIndexes()
  }

  private async createJsonIndexes(): Promise<void> {
    return this.withCircuitBreaker(async () => {
      // Create index for content->metadata->isChunk property
      await this.drizzleDb.execute(sql`
        CREATE INDEX IF NOT EXISTS knowledge_content_metadata_ischunk_idx 
        ON knowledge ((content->'metadata'->>'isChunk'))
      `)

      // Create index for content->metadata->source property
      await this.drizzleDb.execute(sql`
        CREATE INDEX IF NOT EXISTS knowledge_content_metadata_source_idx 
        ON knowledge ((content->'metadata'->>'source'))
      `)

      // Create index for content->metadata->kind property
      await this.drizzleDb.execute(sql`
        CREATE INDEX IF NOT EXISTS knowledge_content_metadata_kind_idx 
        ON knowledge ((content->'metadata'->>'kind'))
      `)
    }, 'createJsonIndexes')
  }

  async fetchKnowledge(
    params: FetchKnowledgeParams
  ): Promise<{ results: RAGKnowledgeItem[]; cursor?: string }> {
    return this.withCircuitBreaker(async () => {
      const { agentId, limit = 20, cursor, filters } = params

      const conditions = [eq(Knowledges.agentId, agentId)]

      // If cursor is provided, decode it and add conditions
      if (cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString())
          const { createdAt, id } = decoded

          conditions.push(
            sql`(${Knowledges.createdAt} < ${new Date(createdAt).toISOString()}
                OR (${Knowledges.createdAt} = ${new Date(createdAt).toISOString()} 
                AND ${Knowledges.id} < ${id}))`
          )
        } catch (error) {
          throw new Error(`Invalid cursor format: ${error}`)
        }
      }

      // Add filter conditions from the filters parameter
      if (filters) {
        if (filters.isChunk !== undefined) {
          // Use JSON path operator to filter on metadata.isChunk
          conditions.push(
            filters.isChunk
              ? sql`(content->'metadata'->>'isChunk')::boolean = true`
              : // eslint-disable-next-line max-len
                sql`((content->'metadata'->>'isChunk')::boolean = false OR content->'metadata'->>'isChunk' IS NULL)`
          )
        }

        if (filters.source !== undefined) {
          // Use JSON path operator to filter on metadata.source
          conditions.push(sql`content->'metadata'->>'source' = ${filters.source}`)
        }

        if (filters.kind !== undefined) {
          // Use JSON path operator to filter on metadata.kind
          conditions.push(sql`content->'metadata'->>'kind' = ${filters.kind}`)
        }
      }

      // Query with pagination
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
          isShared: Knowledges.isShared
        })
        .from(Knowledges)
        .where(and(...conditions))
        .orderBy(desc(Knowledges.createdAt), desc(Knowledges.id))
        .limit(limit + 1) // Fetch one extra to determine if there are more items

      // Determine if we have more items and create the next cursor
      const hasMoreItems = results.length > limit
      const items = hasMoreItems ? results.slice(0, limit) : results

      let nextCursor: string | undefined
      if (hasMoreItems && items.length > 0) {
        const lastItem = items[items.length - 1]
        const cursorData = {
          createdAt: lastItem.createdAt?.getTime(),
          id: lastItem.id
        }
        nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64')
      }

      return {
        results: this.convertToRAGKnowledgeItems(items),
        cursor: nextCursor
      }
    }, 'fetchKnowledge')
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
