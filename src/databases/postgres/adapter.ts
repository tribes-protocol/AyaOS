import { ensureUUID, isComparisonOperator, isNull } from '@/common/functions'
import { MemoryFilters, RagKnowledgeItemContent } from '@/common/types'
import { FetchKnowledgeParams, IAyaDatabaseAdapter } from '@/databases/interfaces'
import { Knowledges, Memories } from '@/databases/postgres/schema'
import PostgresDatabaseAdapter from '@elizaos/adapter-postgres'
import { Memory, RAGKnowledgeItem, UUID } from '@elizaos/core'
import { and, cosineDistance, desc, eq, gt, sql, SQL } from 'drizzle-orm'
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

  filterMemories(params: {
    table: string
    filters: MemoryFilters
    limit?: number
  }): Promise<Memory[]> {
    return this.withCircuitBreaker(async () => {
      const { table, filters, limit = 100 } = params

      const conditions: SQL[] = [eq(Memories.type, table)]

      if (filters && Object.keys(filters).length > 0) {
        for (const [key, value] of Object.entries(filters)) {
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const operatorConditions = this.processComplexFilters(key, value)
            if (operatorConditions) {
              conditions.push(operatorConditions)
            }
          } else if (Array.isArray(value)) {
            const pathAsJson = jsonPathExpr(sql`${Memories.content}`, key, false)

            conditions.push(
              sql`${pathAsJson}::jsonb ?| ARRAY[${sql.join(
                value.map((v) => sql`${String(v)}`),
                sql`, `
              )}]::text[]`
            )
          } else if (typeof value === 'boolean') {
            const pathAsText = jsonPathExpr(sql`${Memories.content}`, key, true)
            conditions.push(sql`(${pathAsText})::boolean = ${value}`)
          } else {
            const pathAsText = jsonPathExpr(sql`${Memories.content}`, key, true)
            conditions.push(sql`${pathAsText} = ${String(value)}`)
          }
        }
      }

      const results = await this.drizzleDb
        .select()
        .from(Memories)
        .where(and(...conditions))
        .orderBy(desc(Memories.createdAt))
        .limit(limit)

      return results.map((row) => ({
        id: row.id,
        type: row.type,
        createdAt: row.createdAt?.getTime(),
        content: row.content,
        embedding: row.embedding || undefined,
        userId: row.userId,
        agentId: row.agentId,
        roomId: row.roomId,
        unique: row.unique
      }))
    }, 'filterMemories')
  }

  private processComplexFilters(key: string, operatorObj: Record<string, unknown>): SQL | null {
    if (!isComparisonOperator(operatorObj)) {
      return null
    }

    const conditions: SQL[] = []

    for (const [operator, operand] of Object.entries(operatorObj)) {
      switch (operator) {
        case '$eq': {
          const pathAsText = jsonPathExpr(sql`${Memories.content}`, key, true)
          conditions.push(sql`${pathAsText} = ${String(operand)}`)
          break
        }
        case '$ne': {
          const pathAsText = jsonPathExpr(sql`${Memories.content}`, key, true)
          conditions.push(sql`${pathAsText} != ${String(operand)}`)
          break
        }
        case '$gt': {
          const pathAsText = jsonPathExpr(sql`${Memories.content}`, key, true)
          conditions.push(sql`(${pathAsText})::numeric > ${Number(operand)}`)
          break
        }
        case '$gte': {
          const pathAsText = jsonPathExpr(sql`${Memories.content}`, key, true)
          conditions.push(sql`(${pathAsText})::numeric >= ${Number(operand)}`)
          break
        }
        case '$lt': {
          const pathAsText = jsonPathExpr(sql`${Memories.content}`, key, true)
          conditions.push(sql`(${pathAsText})::numeric < ${Number(operand)}`)
          break
        }
        case '$lte': {
          const pathAsText = jsonPathExpr(sql`${Memories.content}`, key, true)
          conditions.push(sql`(${pathAsText})::numeric <= ${Number(operand)}`)
          break
        }
        case '$in': {
          if (Array.isArray(operand)) {
            const placeholders = operand.map((v) => sql`${String(v)}`)
            conditions.push(
              // eslint-disable-next-line max-len
              sql`((${Memories.content}->>(${key}::text))::text) IN (${sql.join(placeholders, sql`, `)})`
            )
          }
          break
        }
        case '$contains': {
          if (Array.isArray(operand)) {
            const placeholders = operand.map((v) => sql`${String(v)}`)

            conditions.push(
              sql`
                  (${Memories.content}->(${key}::text))::jsonb 
                  ?| ARRAY[${sql.join(placeholders, sql`, `)}]::text[]
                `
            )
          }
          break
        }
      }
    }

    if (conditions.length === 0) {
      return null
    }

    const result = and(...conditions)
    if (isNull(result)) return null
    return result
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
      const { agentId, limit = 20, cursor, filters, sort = 'desc' } = params

      const conditions = [eq(Knowledges.agentId, agentId)]

      // If cursor is provided, decode it and add conditions
      if (cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString())
          const { createdAt, id } = decoded

          if (sort === 'desc') {
            conditions.push(
              sql`(${Knowledges.createdAt} < ${new Date(createdAt).toISOString()}
                  OR (${Knowledges.createdAt} = ${new Date(createdAt).toISOString()} 
                  AND ${Knowledges.id} < ${id}))`
            )
          } else {
            conditions.push(
              sql`(${Knowledges.createdAt} > ${new Date(createdAt).toISOString()}
                  OR (${Knowledges.createdAt} = ${new Date(createdAt).toISOString()} 
                  AND ${Knowledges.id} > ${id}))`
            )
          }
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
      const query = this.drizzleDb
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
        .limit(limit + 1) // Fetch one extra to determine if there are more items

      // Add sorting based on sort
      if (sort === 'desc') {
        query.orderBy(desc(Knowledges.createdAt), desc(Knowledges.id))
      } else {
        query.orderBy(Knowledges.createdAt, Knowledges.id)
      }

      const results = await query

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

function jsonPathExpr(base: SQL, dottedKey: string, asText = true): SQL {
  const parts = dottedKey.split('.')
  if (parts.length === 0) return sql`${base}->>('${dottedKey}'::text)`

  const last = parts.pop()

  let expr = parts.reduce((acc, segment) => {
    return sql`${acc}->(${segment}::text)`
  }, base)

  if (asText) {
    expr = sql`${expr}->>(${last}::text)`
  } else {
    expr = sql`${expr}->(${last}::text)`
  }

  return expr
}
