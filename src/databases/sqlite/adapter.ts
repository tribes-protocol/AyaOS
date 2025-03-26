import { ensureUUID, isComparisonOperator } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import { ComparisonOperator, FilterPrimitive, MemoryFilters } from '@/common/types'
import { FetchKnowledgeParams, IAyaDatabaseAdapter } from '@/databases/interfaces'
import { SqliteDatabaseAdapter } from '@elizaos/adapter-sqlite'
import { Memory, RAGKnowledgeItem } from '@elizaos/core'
import Database from 'better-sqlite3'

// Define the shape of cursor data for type safety
interface PaginationCursor {
  createdAt: number
  id: string
}

// Knowledge row interface
interface KnowledgeRow {
  id: string
  agentId: string | null
  content: string
  embedding: Buffer | null
  createdAt: string | number
  isMain: number
  originalId: string | null
  chunkIndex: number | null
  isShared: number
}

// Define interface for memories table row
interface MemoryRow {
  id: string
  type: string
  roomId: string
  agentId: string
  userId: string
  content: string
  embedding?: Buffer
  createdAt: string | number
  unique?: number
  [key: string]: unknown
}

export class AyaSqliteDatabaseAdapter extends SqliteDatabaseAdapter implements IAyaDatabaseAdapter {
  constructor(dbFile: string) {
    super(new Database(dbFile))
    ayaLogger.info('Using sqlite db')
  }

  async filterMemories(params: {
    table: string
    filters: MemoryFilters
    limit?: number
  }): Promise<Memory[]> {
    const { table, filters, limit = 100 } = params

    let sql = `SELECT * FROM memories WHERE type = ?`
    const queryParams: (string | number | boolean)[] = [table]

    if (filters && Object.keys(filters).length > 0) {
      for (const [key, value] of Object.entries(filters)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          if (isComparisonOperator(value)) {
            const conditions = this.processComplexFilter(key, value)
            if (conditions) {
              sql += ` AND ${conditions.sql}`
              queryParams.push(...conditions.params)
            }
          }
        } else if (Array.isArray(value)) {
          sql += ` AND json_extract(content, '$.${key}') IN (${value.map(() => '?').join(',')})`
          queryParams.push(...value)
        } else if (typeof value === 'boolean') {
          sql += ` AND json_extract(content, '$.${key}') = ?`
          queryParams.push(value ? 1 : 0)
        } else {
          sql += ` AND json_extract(content, '$.${key}') = ?`
          queryParams.push(this.safelyConvertValue(value))
        }
      }
    }

    sql += ` ORDER BY createdAt DESC LIMIT ?`
    queryParams.push(limit)

    const stmt = this.db.prepare(sql)
    const results = stmt.all(...queryParams)

    const typedResults = this.safelyMapToMemoryRows(results)

    return typedResults.map((row) => ({
      id: ensureUUID(row.id),
      userId: ensureUUID(row.userId),
      agentId: ensureUUID(row.agentId),
      roomId: ensureUUID(row.roomId),
      createdAt: typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : row.createdAt,
      content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
      embedding: row.embedding ? Array.from(new Uint8Array(row.embedding)) : undefined,
      unique: row.unique === 1
    }))
  }

  private safelyConvertValue(value: unknown): string | number | boolean {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value
    }
    return String(value)
  }

  private processComplexFilter(
    key: string,
    operatorObj: ComparisonOperator<FilterPrimitive>
  ): { sql: string; params: (string | number | boolean)[] } | null {
    const conditions: string[] = []
    const params: (string | number | boolean)[] = []

    for (const [operator, operand] of Object.entries(operatorObj)) {
      switch (operator) {
        case '$gt':
          conditions.push(`json_extract(content, '$.${key}') > ?`)
          params.push(Number(operand))
          break
        case '$gte':
          conditions.push(`json_extract(content, '$.${key}') >= ?`)
          params.push(Number(operand))
          break
        case '$lt':
          conditions.push(`json_extract(content, '$.${key}') < ?`)
          params.push(Number(operand))
          break
        case '$lte':
          conditions.push(`json_extract(content, '$.${key}') <= ?`)
          params.push(Number(operand))
          break
        case '$eq':
          conditions.push(`json_extract(content, '$.${key}') = ?`)
          params.push(this.safelyConvertValue(operand))
          break
        case '$ne':
          conditions.push(`json_extract(content, '$.${key}') != ?`)
          params.push(this.safelyConvertValue(operand))
          break
        case '$in':
          if (Array.isArray(operand)) {
            conditions.push(
              `json_extract(content, '$.${key}') IN (${operand.map(() => '?').join(',')})`
            )
            params.push(...operand.map((v) => this.safelyConvertValue(v)))
          }
          break
        case '$contains':
          if (Array.isArray(operand)) {
            conditions.push(
              `EXISTS (SELECT 1 FROM json_each(json_extract(content, '$.${key}')) WHERE ${operand
                .map(() => 'value = ?')
                .join(' OR ')})`
            )

            params.push(...operand.map((v) => this.safelyConvertValue(v)))
          }
          break
      }
    }

    if (conditions.length === 0) return null

    return {
      sql: conditions.join(' AND '),
      params
    }
  }

  private safelyMapToMemoryRows(results: unknown): MemoryRow[] {
    if (!Array.isArray(results)) {
      return []
    }

    return results.map((item) => {
      if (!item || typeof item !== 'object') {
        return {
          id: '',
          type: '',
          roomId: '',
          agentId: '',
          userId: '',
          content: '{}',
          createdAt: Date.now()
        }
      }

      if (this.isRecordWithStringKeys(item)) {
        return {
          id: typeof item.id === 'string' ? item.id : '',
          type: typeof item.type === 'string' ? item.type : '',
          roomId: typeof item.roomId === 'string' ? item.roomId : '',
          agentId: typeof item.agentId === 'string' ? item.agentId : '',
          userId: typeof item.userId === 'string' ? item.userId : '',
          content: typeof item.content === 'string' ? item.content : '{}',
          embedding: Buffer.isBuffer(item.embedding) ? item.embedding : undefined,
          createdAt:
            typeof item.createdAt === 'string' || typeof item.createdAt === 'number'
              ? item.createdAt
              : Date.now(),
          unique: typeof item.unique === 'number' ? item.unique : undefined
        }
      }

      return {
        id: '',
        type: '',
        roomId: '',
        agentId: '',
        userId: '',
        content: '{}',
        createdAt: Date.now()
      }
    })
  }

  private isRecordWithStringKeys(obj: object): obj is Record<string, unknown> {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      !Array.isArray(obj) &&
      Object.keys(obj).every((key) => typeof key === 'string')
    )
  }

  private async addIndex(columnName: string, jsonPath: string): Promise<void> {
    try {
      // Try to add the column - if it exists, this will fail silently
      this.db.exec(`
        ALTER TABLE knowledge ADD COLUMN ${columnName} TEXT 
        GENERATED ALWAYS AS (
          json_extract(content, '${jsonPath}')
        ) STORED;
      `)

      // Create index - IF NOT EXISTS ensures no duplicate index error
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_knowledge_${columnName.replace('metadata_', '')} 
        ON knowledge(${columnName});
      `)
    } catch (error) {
      // If error is about duplicate column, we can safely ignore it
      if (error instanceof Error && !error.message.includes('duplicate column')) {
        ayaLogger.error(`Failed to create column ${columnName}:`, error)
      }
    }
  }

  async init(): Promise<void> {
    await super.init()

    // Add generated columns and indexes for JSON filtering
    await this.addIndex('metadata_isChunk', '$.metadata.isChunk')
    await this.addIndex('metadata_source', '$.metadata.source')
    await this.addIndex('metadata_kind', '$.metadata.kind')
  }

  async fetchKnowledge(
    params: FetchKnowledgeParams
  ): Promise<{ results: RAGKnowledgeItem[]; cursor?: string }> {
    const { agentId, limit = 20, cursor, filters, sort = 'desc' } = params

    let sql = 'SELECT * FROM knowledge WHERE (agentId = ? OR isShared = 1)'
    const queryParams: (string | number | boolean)[] = [agentId]

    // If cursor is provided, decode it and add conditions
    if (cursor) {
      try {
        const decodedString = Buffer.from(cursor, 'base64').toString()

        // Parse and validate the cursor
        const decodedObj = JSON.parse(decodedString)

        // Validate cursor structure
        if (!this.isValidCursor(decodedObj)) {
          throw new Error('Invalid cursor format')
        }

        // Now TypeScript knows decodedObj has the right structure
        const { createdAt, id } = decodedObj

        // In SQLite, we need to handle date comparison a bit differently
        if (sort === 'desc') {
          sql += ' AND (createdAt < ? OR (createdAt = ? AND id < ?))'
        } else {
          sql += ' AND (createdAt > ? OR (createdAt = ? AND id > ?))'
        }
        queryParams.push(new Date(createdAt).toISOString(), new Date(createdAt).toISOString(), id)
      } catch (error) {
        throw new Error(`Invalid cursor format: ${error}`)
      }
    }

    // Add filter conditions if provided
    if (filters) {
      if (filters.isChunk !== undefined) {
        // Use the virtual column we created
        if (filters.isChunk) {
          sql += " AND metadata_isChunk = 'true'"
        } else {
          sql += " AND (metadata_isChunk = 'false' OR metadata_isChunk IS NULL)"
        }
      }

      if (filters.source !== undefined) {
        // Use the virtual column we created
        sql += ' AND metadata_source = ?'
        queryParams.push(filters.source)
      }

      if (filters.kind !== undefined) {
        // Use the virtual column we created
        sql += ' AND metadata_kind = ?'
        queryParams.push(filters.kind)
      }
    }

    // Add ordering and limit with one extra item to determine if there are more results
    sql += ` ORDER BY createdAt ${sort === 'desc' ? 'DESC' : 'ASC'}, id ${
      sort === 'desc' ? 'DESC' : 'ASC'
    } LIMIT ?`
    queryParams.push(limit + 1)

    // Execute the query and handle results safely
    const stmt = this.db.prepare(sql)
    const results = stmt.all(...queryParams)

    // Type guard and map results to ensure type safety
    const rows = this.mapQueryResultsToKnowledgeRows(results)

    // Determine if we have more items and create the next cursor
    const hasMoreItems = rows.length > limit
    const items = hasMoreItems ? rows.slice(0, limit) : rows

    let nextCursor: string | undefined
    if (hasMoreItems && items.length > 0) {
      const lastItem = items[items.length - 1]
      const cursorData: PaginationCursor = {
        createdAt:
          typeof lastItem.createdAt === 'string'
            ? Date.parse(lastItem.createdAt)
            : lastItem.createdAt,
        id: lastItem.id
      }
      nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64')
    }

    // Transform results to RAGKnowledgeItems
    const knowledgeItems = items.map((row) => this.rowToKnowledgeItem(row))

    return {
      results: knowledgeItems,
      cursor: nextCursor
    }
  }

  // Type guard for cursor validation
  private isValidCursor(obj: unknown): obj is PaginationCursor {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'createdAt' in obj &&
      typeof obj.createdAt === 'number' &&
      'id' in obj &&
      typeof obj.id === 'string'
    )
  }

  // Helper method to safely convert query results to typed rows
  private mapQueryResultsToKnowledgeRows(results: unknown): KnowledgeRow[] {
    if (!Array.isArray(results)) {
      return []
    }

    return results.map((item) => {
      // Make sure we handle all properties safely
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const row = item as Record<string, unknown>
      return {
        id: typeof row.id === 'string' ? row.id : '',
        agentId: typeof row.agentId === 'string' ? row.agentId : null,
        content: typeof row.content === 'string' ? row.content : '',
        embedding: Buffer.isBuffer(row.embedding) ? row.embedding : null,
        createdAt:
          typeof row.createdAt === 'string' || typeof row.createdAt === 'number'
            ? row.createdAt
            : Date.now(),
        isMain: typeof row.isMain === 'number' ? row.isMain : 0,
        originalId: typeof row.originalId === 'string' ? row.originalId : null,
        chunkIndex: typeof row.chunkIndex === 'number' ? row.chunkIndex : null,
        isShared: typeof row.isShared === 'number' ? row.isShared : 0
      }
    })
  }

  // Helper method to convert a database row to a knowledge item
  private rowToKnowledgeItem(row: KnowledgeRow): RAGKnowledgeItem {
    // Parse content safely
    let parsedContent: { text?: string; metadata?: Record<string, unknown> } = {}
    try {
      const parsed = JSON.parse(row.content)
      if (parsed && typeof parsed === 'object') {
        parsedContent = parsed
      }
    } catch {
      // If parsing fails, use empty object (no variable needed)
    }

    // Create metadata
    const metadata: Record<string, unknown> = {}

    if (row.isMain) metadata.isMain = Boolean(row.isMain)
    if (row.originalId) metadata.originalId = row.originalId
    if (row.chunkIndex !== null) metadata.chunkIndex = row.chunkIndex
    if (row.isShared) metadata.isShared = Boolean(row.isShared)

    // Merge with existing metadata if available
    if (parsedContent.metadata && typeof parsedContent.metadata === 'object') {
      Object.assign(metadata, parsedContent.metadata)
    }

    // Create text content safely
    let textContent = ''
    if (typeof parsedContent === 'object' && parsedContent && 'text' in parsedContent) {
      textContent = parsedContent.text ? String(parsedContent.text) : ''
    } else {
      textContent = JSON.stringify(parsedContent)
    }

    return {
      id: ensureUUID(row.id),
      agentId: ensureUUID(row.agentId),
      content: {
        text: textContent,
        metadata
      },
      embedding: row.embedding ? new Float32Array(row.embedding) : undefined,
      createdAt: typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : row.createdAt
    }
  }
}
