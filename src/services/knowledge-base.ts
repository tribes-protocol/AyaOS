import { drizzleDB } from '@/common/db'
import { calculateChecksum, ensureUUID } from '@/common/functions'
import { AgentcoinRuntime } from '@/common/runtime'
import { Knowledges, RagKnowledgeItemContent } from '@/common/schema'
import { ServiceKind } from '@/common/types'
import { IKnowledgeBaseService } from '@/services/interfaces'
import {
  elizaLogger,
  embed,
  getEmbeddingZeroVector,
  RAGKnowledgeItem,
  Service,
  ServiceType,
  stringToUuid,
  UUID
} from '@elizaos/core'
import { and, cosineDistance, desc, eq, gt, sql } from 'drizzle-orm'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'

export class KnowledgeBaseService extends Service implements IKnowledgeBaseService {
  private readonly textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 7000, // text-embedding-ada-002 has a max token limit of ~8000
    chunkOverlap: 500,
    separators: ['\n## ', '\n### ', '\n#### ', '\n', ' ', '']
  })

  constructor(private readonly runtime: AgentcoinRuntime) {
    super()
  }

  static get serviceType(): ServiceType {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ServiceKind.knowledgeBase as unknown as ServiceType
  }

  async initialize(_: AgentcoinRuntime): Promise<void> {
    elizaLogger.info('initializing knowledge base service')
    // Create index on knowledge.content.type
    await drizzleDB.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_knowledge_content_type 
          ON knowledge((content->'metadata'->>'type'));`
    )
  }

  async list(options?: {
    limit?: number
    contentType?: string
    sortDirection?: 'asc' | 'desc'
  }): Promise<RAGKnowledgeItem[]> {
    /* eslint-disable @typescript-eslint/no-unsafe-member-access */
    const { limit = 10, contentType, sortDirection = 'desc' } = options ?? {}

    // Build the query conditions
    const conditions = [eq(Knowledges.agentId, this.runtime.agentId)]

    // Add content type filter if specified
    if (contentType) {
      conditions.push(sql`${Knowledges.content}->'metadata'->>'type' = ${contentType}`)
    }

    // Execute the query with proper sorting

    const results = await drizzleDB
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
      .orderBy(sortDirection === 'desc' ? desc(Knowledges.createdAt) : Knowledges.createdAt)
      .limit(limit)

    // Convert the database results to RAGKnowledgeItem format
    return this.convertToRAGKnowledgeItems(results)
  }

  async search(options: {
    q: string
    limit: number
    matchThreshold?: number
  }): Promise<RAGKnowledgeItem[]> {
    const { q, limit, matchThreshold = 0.5 } = options
    const embedding = await embed(this.runtime, q)
    /* eslint-disable @typescript-eslint/no-unsafe-member-access */
    const similarity = sql<number>`1 - (${cosineDistance(Knowledges.embedding, embedding)})`

    const results = await drizzleDB
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
          eq(Knowledges.agentId, this.runtime.agentId),
          eq(Knowledges.isMain, false)
        )
      )
      .orderBy((t) => desc(t.similarity))
      .limit(limit)

    return this.convertToRAGKnowledgeItems(results)
  }

  /**
   * Converts database query results to RAGKnowledgeItem objects
   * @param results - The database query results
   * @returns An array of RAGKnowledgeItem objects
   * @private
   */
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
      similarity?: number
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
      if (result.originalId && result.originalId !== null) {
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
        agentId: ensureUUID(result.agentId ?? this.runtime.agentId),
        content: {
          text,
          metadata
        },
        ...(result.similarity !== undefined ? { similarity: result.similarity } : {}),
        ...(result.embedding && result.embedding !== null
          ? { embedding: new Float32Array(result.embedding) }
          : {}),
        ...(result.createdAt && result.createdAt !== null
          ? { createdAt: result.createdAt.getTime() }
          : {})
      }
      return item
    })
  }

  async get(id: UUID): Promise<RAGKnowledgeItem | undefined> {
    const results = await drizzleDB
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
      .where(and(eq(Knowledges.id, id), eq(Knowledges.agentId, this.runtime.agentId)))
      .limit(1)

    if (results.length === 0) {
      return undefined
    }

    return this.convertToRAGKnowledgeItems(results)[0]
  }

  async add(id: UUID, knowledge: RagKnowledgeItemContent): Promise<void> {
    const databaseAdapter = this.runtime.databaseAdapter
    const agentId = this.runtime.agentId
    const checksum = calculateChecksum(knowledge.text)
    const kbType = knowledge.metadata?.type ?? 'unknown'
    const storedKB: RAGKnowledgeItem | undefined = (
      await databaseAdapter.getKnowledge({
        id,
        agentId,
        limit: 1
      })
    )[0]

    if (storedKB?.content.metadata?.checksum === checksum) {
      elizaLogger.debug(`[${kbType}] knowledge=[${id}] already exists. skipping...`)
      return
    }

    // create main knowledge item
    const knowledgeItem: RAGKnowledgeItem = {
      id,
      agentId,
      content: {
        text: '',
        metadata: {
          ...Object.fromEntries(
            Object.entries(knowledge.metadata || {}).filter(([_, v]) => v !== null)
          ),
          isMain: true,
          isChunk: false,
          originalId: undefined,
          chunkIndex: undefined,
          checksum
        }
      },
      embedding: new Float32Array(getEmbeddingZeroVector()),
      createdAt: Date.now()
    }

    // delete old knowledge item
    if (storedKB) {
      await databaseAdapter.removeKnowledge(id)
    }

    // create main knowledge item
    await databaseAdapter.createKnowledge(knowledgeItem)

    // Split the content into chunks
    const chunks = await this.textSplitter.createDocuments([knowledge.text])
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const chunkId: UUID = stringToUuid(`${id}-${i}`)

      elizaLogger.info(`processing chunk id=${chunkId} page=${i} id=${id}`)

      const embeddings = await embed(this.runtime, chunk.pageContent)
      const knowledgeItem: RAGKnowledgeItem = {
        id: chunkId,
        agentId,
        content: {
          text: chunk.pageContent,
          metadata: {
            ...Object.fromEntries(
              Object.entries(knowledge.metadata || {}).filter(([_, v]) => v !== null)
            ),
            isMain: false,
            isChunk: true,
            originalId: id,
            chunkIndex: i,
            source: undefined,
            type: kbType,
            checksum
          }
        },
        embedding: new Float32Array(embeddings),
        createdAt: Date.now()
      }

      await databaseAdapter.createKnowledge(knowledgeItem)
    }
  }

  async remove(id: UUID): Promise<void> {
    await this.runtime.databaseAdapter.removeKnowledge(id)
  }
}
