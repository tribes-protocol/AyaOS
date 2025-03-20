import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { drizzleDB } from '@/common/db'
import { calculateChecksum, ensureUUID } from '@/common/functions'
import { AyaRuntime } from '@/common/runtime'
import { Knowledges, RagKnowledgeItemContent } from '@/common/schema'
import { Identity, Knowledge, ServiceKind } from '@/common/types'
import { IKnowledgeService } from '@/services/interfaces'
import {
  elizaLogger,
  embed,
  getEmbeddingZeroVector,
  IAgentRuntime,
  RAGKnowledgeItem,
  RAGKnowledgeManager,
  Service,
  ServiceType,
  stringToUuid,
  UUID
} from '@elizaos/core'
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import axios from 'axios'
import { and, cosineDistance, desc, eq, gt, sql } from 'drizzle-orm'
import fs from 'fs/promises'
import { TextLoader } from 'langchain/document_loaders/fs/text'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import path from 'path'

export class KnowledgeService extends Service implements IKnowledgeService {
  private readonly knowledgeRoot: string
  private isRunning = false
  private readonly textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 7000, // text-embedding-ada-002 has a max token limit of ~8000
    chunkOverlap: 500,
    separators: ['\n## ', '\n### ', '\n#### ', '\n', ' ', '']
  })

  static get serviceType(): ServiceType {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ServiceKind.knowledge as unknown as ServiceType
  }

  async initialize(_: IAgentRuntime): Promise<void> {
    elizaLogger.info('initializing knowledge service')
    // Create index on knowledge.content.type
    await drizzleDB.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_knowledge_content_type 
          ON knowledge((content->'metadata'->>'type'));`
    )
  }

  constructor(
    private readonly runtime: AyaRuntime,
    private readonly agentCoinApi: AgentcoinAPI,
    private readonly agentCoinCookie: string,
    private readonly agentCoinIdentity: Identity
  ) {
    super()
    if (this.runtime.ragKnowledgeManager instanceof RAGKnowledgeManager) {
      this.knowledgeRoot = this.runtime.ragKnowledgeManager.knowledgeRoot
    } else {
      throw new Error('RAGKnowledgeManager not found')
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return
    }

    elizaLogger.info('📌 Knowledge sync job started...')
    this.isRunning = true

    while (this.isRunning) {
      try {
        await this.syncKnowledge()
      } catch (error) {
        if (error instanceof Error) {
          elizaLogger.error('⚠️ Error in sync job:', error.message)
        } else {
          elizaLogger.error('⚠️ Error in sync job:', error)
        }
      }

      // Wait for 1 minute before the next run
      await new Promise((resolve) => setTimeout(resolve, 60_000))
    }

    elizaLogger.info('✅ Sync job stopped gracefully.')
  }

  async stop(): Promise<void> {
    this.isRunning = false
    elizaLogger.info('Knowledge sync service stopped')
  }

  private async getAllKnowledge(): Promise<Knowledge[]> {
    const allKnowledge: Knowledge[] = []
    let cursor = 0
    const limit = 100

    while (true) {
      const knowledges = await this.agentCoinApi.getKnowledges(this.agentCoinIdentity, {
        cookie: this.agentCoinCookie,
        limit,
        cursor
      })

      allKnowledge.push(...knowledges)

      if (knowledges.length < limit) {
        break
      }

      cursor = knowledges[knowledges.length - 1].id
    }

    elizaLogger.info(`Found ${allKnowledge.length} knowledges`)

    return allKnowledge
  }

  private async syncKnowledge(): Promise<void> {
    elizaLogger.info('Syncing knowledge...')
    try {
      const [knowledges, existingKnowledges] = await Promise.all([
        this.getAllKnowledge(),
        this.listAll()
      ])

      const existingParentKnowledges = existingKnowledges.filter(
        (knowledge) => !knowledge.content.metadata?.isChunk
      )
      const existingKnowledgeIds = existingParentKnowledges.map((knowledge) => knowledge.id)

      const remoteKnowledgeIds: UUID[] = []
      for (const knowledge of knowledges) {
        const itemId = stringToUuid(knowledge.metadata.url)
        remoteKnowledgeIds.push(itemId)

        if (!existingKnowledgeIds.includes(itemId)) {
          elizaLogger.info(`Processing new knowledge: ${knowledge.name}`)
          await this.processFileKnowledge(knowledge, itemId)
        }
      }

      const knowledgesToRemove = existingParentKnowledges.filter(
        (knowledge) => !remoteKnowledgeIds.includes(knowledge.id)
      )

      for (const knowledge of knowledgesToRemove) {
        elizaLogger.info(`Removing knowledge: ${knowledge.content.metadata?.source}`)

        await this.remove(knowledge.id)

        await this.runtime.ragKnowledgeManager.cleanupDeletedKnowledgeFiles()
      }
      elizaLogger.info(
        `Knowledge sync completed: ${remoteKnowledgeIds.length} remote items, ` +
          `${knowledgesToRemove.length} items removed`
      )
    } catch (error) {
      if (error instanceof Error) {
        elizaLogger.error('Error processing knowledge files:', error.message)
      } else {
        elizaLogger.error('Error processing knowledge files:', error)
      }
      throw error
    }
  }

  private async processFileKnowledge(data: Knowledge, itemId: UUID): Promise<void> {
    try {
      const content = await this.downloadFile(data)

      await this.add(itemId, {
        text: content,
        metadata: {
          source: data.name
        }
      })
    } catch (error) {
      elizaLogger.error(`Error processing file metadata for ${data.name}:`, error)
    }
  }

  private async downloadFile(file: Knowledge): Promise<string> {
    await fs.mkdir(this.knowledgeRoot, { recursive: true })
    const outputPath = path.join(this.knowledgeRoot, file.name)

    try {
      const response = await axios({
        method: 'GET',
        url: file.metadata.url,
        responseType: 'arraybuffer'
      })

      await fs.writeFile(outputPath, response.data)

      const loaderMap = {
        '.txt': TextLoader,
        '.md': TextLoader,
        '.csv': CSVLoader,
        '.pdf': PDFLoader,
        '.docx': DocxLoader
      } as const

      const isValidFileExtension = (ext: string): ext is keyof typeof loaderMap => {
        return ext in loaderMap
      }

      const fileExtension = path.extname(file.name).toLowerCase()
      if (!isValidFileExtension(fileExtension)) {
        elizaLogger.error(`Unsupported file type: ${fileExtension}`)
        throw new Error(`Unsupported file type: ${fileExtension}`)
      }

      const LoaderClass = loaderMap[fileExtension]

      try {
        const loader = new LoaderClass(outputPath)
        const docs = await loader.load()
        const content = docs.map((doc) => doc.pageContent).join('\n')
        elizaLogger.info(`Successfully processed file: ${file.name}`)
        return content
      } catch (error) {
        elizaLogger.error(`Error parsing ${fileExtension} file: ${file.name}`, error)
        return ''
      }
    } catch (error) {
      elizaLogger.error(`Error processing file from ${file.metadata.url}:`, error)
      throw error
    }
  }

  async listAll(): Promise<RAGKnowledgeItem[]> {
    const results = await drizzleDB
      .select()
      .from(Knowledges)
      .where(eq(Knowledges.agentId, this.runtime.agentId))
    return this.convertToRAGKnowledgeItems(results)
  }

  async list(options?: {
    limit?: number
    contentType?: string
    sortDirection?: 'asc' | 'desc'
  }): Promise<RAGKnowledgeItem[]> {
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
          // Move checksum and other properties to metadata
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
