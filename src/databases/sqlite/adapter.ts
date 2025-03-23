import { ensureUUID } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import { FetchKnowledgeParams, IAyaDatabaseAdapter } from '@/databases/interfaces'
import { SqliteDatabaseAdapter } from '@elizaos/adapter-sqlite'
import { RAGKnowledgeItem } from '@elizaos/core'
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

export class AyaSqliteDatabaseAdapter extends SqliteDatabaseAdapter implements IAyaDatabaseAdapter {
  constructor(dbFile: string) {
    super(new Database(dbFile))
    ayaLogger.info('Using sqlite db')
  }

  async init(): Promise<void> {
    await super.init()

    // Create generated columns and indexes for JSON filtering
    try {
      // SQLite doesn't have native JSON indexing, but we can use a GENERATED COLUMN approach
      // First, check if we need to add these columns (only run if the columns don't exist)
      interface TableInfoRow {
        name: string
        [key: string]: unknown
      }

      const rawColumns = this.db.prepare("PRAGMA table_info('knowledge')").all()

      // Extract column names using type predicate in the filter callback
      const existingColumns = rawColumns
        .filter(
          (row): row is TableInfoRow =>
            row !== null && typeof row === 'object' && 'name' in row && typeof row.name === 'string'
        )
        .map((row) => row.name)

      if (!existingColumns.includes('metadata_isChunk')) {
        // Add STORED column for isChunk (not VIRTUAL) so it can be indexed
        this.db.exec(`
          ALTER TABLE knowledge ADD COLUMN metadata_isChunk TEXT 
          GENERATED ALWAYS AS (
            json_extract(content, '$.metadata.isChunk')
          ) STORED;
        `)

        // Create index on the generated column
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_knowledge_isChunk 
          ON knowledge(metadata_isChunk);
        `)
      }

      if (!existingColumns.includes('metadata_source')) {
        // Add STORED column for source (not VIRTUAL) so it can be indexed
        this.db.exec(`
          ALTER TABLE knowledge ADD COLUMN metadata_source TEXT 
          GENERATED ALWAYS AS (
            json_extract(content, '$.metadata.source')
          ) STORED;
        `)

        // Create index on the generated column
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_knowledge_source 
          ON knowledge(metadata_source);
        `)
      }

      if (!existingColumns.includes('metadata_kind')) {
        // Add STORED column for kind (not VIRTUAL) so it can be indexed
        this.db.exec(`
          ALTER TABLE knowledge ADD COLUMN metadata_kind TEXT 
          GENERATED ALWAYS AS (
            json_extract(content, '$.metadata.kind')
          ) STORED;
        `)

        // Create index on the generated column
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_knowledge_kind 
          ON knowledge(metadata_kind);
        `)
      }
    } catch (error) {
      ayaLogger.error('Failed to create generated columns for SQLite:', error)
    }
  }

  async fetchKnowledge(
    params: FetchKnowledgeParams
  ): Promise<{ results: RAGKnowledgeItem[]; cursor?: string }> {
    const { agentId, limit = 20, cursor, filters } = params

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
        sql += ' AND (createdAt < ? OR (createdAt = ? AND id < ?))'
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
    sql += ' ORDER BY createdAt DESC, id DESC LIMIT ?'
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
