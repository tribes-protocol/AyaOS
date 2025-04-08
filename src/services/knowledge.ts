import { AgentRegistry } from '@/agent/registry'
import { AgentcoinAPI } from '@/apis/aya'
import { AyaAuthAPI } from '@/apis/aya-auth'
import {
  AYA_AGENT_DATA_DIR_KEY,
  AYA_AGENT_IDENTITY_KEY,
  AYA_JWT_SETTINGS_KEY
} from '@/common/constants'
import { calculateChecksum, ensureStringSetting, isNull } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import {
  AgentIdentitySchema,
  Identity,
  Knowledge,
  RAGKnowledgeItem,
  RagKnowledgeItemContent
} from '@/common/types'
import { PathManager } from '@/managers/path'
import { IKnowledgeService } from '@/services/interfaces'
import {
  createUniqueUuid,
  IAgentRuntime,
  ModelType,
  Service,
  splitChunks,
  stringToUuid,
  UUID,
  VECTOR_DIMS
} from '@elizaos/core'
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import axios from 'axios'
import { and, asc, cosineDistance, desc, eq, gt, gte, lt, sql } from 'drizzle-orm'
import { drizzle as drizzlePg, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { boolean, pgTable, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core'
import { drizzle, PgliteDatabase } from 'drizzle-orm/pglite'
import fs from 'fs/promises'
import { TextLoader } from 'langchain/document_loaders/fs/text'
import path from 'path'
import { v4 } from 'uuid'

const DIMENSION_MAP = {
  [VECTOR_DIMS.SMALL]: 'dim384',
  [VECTOR_DIMS.MEDIUM]: 'dim512',
  [VECTOR_DIMS.LARGE]: 'dim768',
  [VECTOR_DIMS.XL]: 'dim1024',
  [VECTOR_DIMS.XXL]: 'dim1536',
  [VECTOR_DIMS.XXXL]: 'dim3072'
} as const

export const Knowledges = pgTable('knowledge', {
  id: uuid('id').$type<UUID>().primaryKey(),
  agentId: uuid('agent_id').$type<UUID>().notNull(),
  text: text('text').notNull(),
  kind: text('kind'),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  isMain: boolean('is_main').default(false),
  checksum: text('checksum'),
  documentId: uuid('document_id').notNull()
})

export const KnowledgeEmbeddings = pgTable('knowledge_embeddings', {
  id: uuid('id').primaryKey().defaultRandom().notNull(),
  knowledgeId: uuid('knowledge_id').references(() => Knowledges.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  dim384: vector('dim_384', { dimensions: VECTOR_DIMS.SMALL }),
  dim512: vector('dim_512', { dimensions: VECTOR_DIMS.MEDIUM }),
  dim768: vector('dim_768', { dimensions: VECTOR_DIMS.LARGE }),
  dim1024: vector('dim_1024', { dimensions: VECTOR_DIMS.XL }),
  dim1536: vector('dim_1536', { dimensions: VECTOR_DIMS.XXL }),
  dim3072: vector('dim_3072', { dimensions: VECTOR_DIMS.XXXL })
})

export class KnowledgeService extends Service implements IKnowledgeService {
  static readonly instances = new Map<UUID, KnowledgeService>()
  private isRunning = false
  private readonly api = new AgentcoinAPI()
  private readonly identity: Identity
  private readonly authAPI: AyaAuthAPI
  private readonly pathResolver: PathManager
  private db!: NodePgDatabase | PgliteDatabase
  private embeddingDimension!: string

  static readonly serviceType = 'aya-os-knowledge-service'
  readonly capabilityDescription = ''

  constructor(readonly runtime: IAgentRuntime) {
    super(runtime)
    const token = ensureStringSetting(runtime, AYA_JWT_SETTINGS_KEY)
    const identity = ensureStringSetting(runtime, AYA_AGENT_IDENTITY_KEY)
    const dataDir = ensureStringSetting(runtime, AYA_AGENT_DATA_DIR_KEY)
    this.authAPI = new AyaAuthAPI(token)
    this.identity = AgentIdentitySchema.parse(identity)

    const { managers } = AgentRegistry.get(dataDir)
    this.pathResolver = managers.path
  }

  private async initializeTables(): Promise<void> {
    try {
      const embedding = await this.runtime.useModel(ModelType.TEXT_EMBEDDING, null)
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      this.embeddingDimension = DIMENSION_MAP[embedding.length as keyof typeof DIMENSION_MAP]

      const postgresUrl = this.runtime.getSetting('POSTGRES_URL')
      const pgliteDataDir = path.join(this.pathResolver.dataDir, 'pglite')

      if (postgresUrl) {
        const pgModule = await import('pg')
        const { Pool } = pgModule.default || pgModule
        const pool = new Pool({ connectionString: postgresUrl })
        this.db = drizzlePg(pool)
        ayaLogger.success('Connected to PostgreSQL database')
      } else {
        const { PGlite } = await import('@electric-sql/pglite')
        const { vector } = await import('@electric-sql/pglite/vector')
        const { fuzzystrmatch } = await import('@electric-sql/pglite/contrib/fuzzystrmatch')
        const pglite = new PGlite({ dataDir: pgliteDataDir, extensions: { vector, fuzzystrmatch } })

        this.db = drizzle(pglite)
        ayaLogger.success('Connected to PGlite database')

        await this.db.execute('CREATE EXTENSION IF NOT EXISTS vector;')
        await this.db.execute('CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;')
      }

      // Create knowledge table if it doesn't exist
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS knowledge (
          id UUID PRIMARY KEY,
          agent_id UUID NOT NULL,
          text TEXT NOT NULL,
          kind TEXT,
          source TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          is_main BOOLEAN DEFAULT FALSE,
          checksum TEXT,
          document_id UUID NOT NULL
        );
      `)

      // Create indexes separately
      await this.db.execute(
        'CREATE INDEX IF NOT EXISTS "idx_knowledge_id" ON "knowledge" USING btree ("id");'
      )
      await this.db.execute(
        'CREATE INDEX IF NOT EXISTS "idx_knowledge_agent_id" ON "knowledge" USING btree ("agent_id");'
      )
      await this.db.execute(
        'CREATE INDEX IF NOT EXISTS "idx_knowledge_is_main" ON "knowledge" USING btree ("is_main");'
      )
      await this.db.execute(
        'CREATE INDEX IF NOT EXISTS "idx_knowledge_document_id" ON "knowledge" USING btree ("document_id");'
      )

      // Create knowledge_embeddings table if it doesn't exist
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS knowledge_embeddings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          knowledge_id UUID REFERENCES knowledge(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          dim_384 VECTOR(${VECTOR_DIMS.SMALL}),
          dim_512 VECTOR(${VECTOR_DIMS.MEDIUM}),
          dim_768 VECTOR(${VECTOR_DIMS.LARGE}),
          dim_1024 VECTOR(${VECTOR_DIMS.XL}),
          dim_1536 VECTOR(${VECTOR_DIMS.XXL}),
          dim_3072 VECTOR(${VECTOR_DIMS.XXXL})
        );
      `)

      ayaLogger.success('Database tables initialized successfully')
    } catch (error) {
      console.error('Failed to initialize database tables:', error)
      throw new Error(
        `Failed to initialize database tables: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  private async start(): Promise<void> {
    if (this.isRunning) {
      return
    }

    await this.initializeTables()

    this.isRunning = true
    while (this.isRunning) {
      try {
        await this.syncKnowledge()
      } catch (error) {
        if (error instanceof Error) {
          ayaLogger.error('⚠️ Error in sync job:', error.message)
        } else {
          ayaLogger.error('⚠️ Error in sync job:', error)
        }
      }
      // Wait for 1 minute before the next run
      await new Promise((resolve) => setTimeout(resolve, 60_000))
    }
    ayaLogger.success('Sync job stopped gracefully.')
  }

  async stop(): Promise<void> {
    this.isRunning = false
    ayaLogger.info('Knowledge sync service stopped')
  }

  static async start(runtime: IAgentRuntime): Promise<Service> {
    let instance = KnowledgeService.instances.get(runtime.agentId)
    if (instance) {
      return instance
    }

    instance = new KnowledgeService(runtime)
    KnowledgeService.instances.set(runtime.agentId, instance)
    // don't await this. it'll lock up the main process
    void instance.start()
    return instance
  }

  static async stop(runtime: IAgentRuntime): Promise<unknown> {
    const instance = KnowledgeService.instances.get(runtime.agentId)
    if (isNull(instance)) {
      return undefined
    }
    await instance.stop()
    return instance
  }

  private async getAllKnowledge(): Promise<Knowledge[]> {
    const allKnowledge: Knowledge[] = []
    let cursor = 0
    const limit = 100

    while (true) {
      const knowledges = await this.api.getKnowledges(this.identity, {
        cookie: this.authAPI.cookie,
        limit,
        cursor
      })

      allKnowledge.push(...knowledges)

      if (knowledges.length < limit) {
        break
      }

      cursor = knowledges[knowledges.length - 1].id
    }

    return allKnowledge
  }

  private async syncKnowledge(): Promise<void> {
    try {
      ayaLogger.info('Getting all knowledges...')
      const knowledges = await this.getAllKnowledge()
      const existingKnowledgeIds = new Set<UUID>()

      let cursor: number | undefined
      do {
        const { items, nextCursor } = await this.list({
          limit: 100,
          cursor
        })

        for (const knowledge of items) {
          if (isNull(knowledge.id)) {
            continue
          }
          existingKnowledgeIds.add(knowledge.id)
        }

        cursor = nextCursor
      } while (cursor)

      const remoteKnowledgeIds: UUID[] = []
      for (const knowledge of knowledges) {
        const itemId = stringToUuid(knowledge.metadata.url)
        remoteKnowledgeIds.push(itemId)

        if (!existingKnowledgeIds.has(itemId)) {
          ayaLogger.info(`Processing new knowledge: ${knowledge.name}`)
          await this.processFileKnowledge(knowledge, itemId)
        }
      }

      const knowledgeIdsToRemove = Array.from(existingKnowledgeIds).filter(
        (id) => !remoteKnowledgeIds.includes(id)
      )

      for (const knowledgeId of knowledgeIdsToRemove) {
        ayaLogger.info(`Removing knowledge: ${knowledgeId}`)
        await this.remove(knowledgeId)
      }

      ayaLogger.info(
        `Knowledge sync completed: ${remoteKnowledgeIds.length} remote items, ` +
          `${knowledgeIdsToRemove.length} items removed`
      )
    } catch (error) {
      if (error instanceof Error) {
        ayaLogger.error(`Error processing knowledge files: ${error.message}`)
      } else {
        ayaLogger.error(`Error processing knowledge files: ${error}`)
      }
      throw error
    }
  }

  private async processFileKnowledge(data: Knowledge, itemId: UUID): Promise<void> {
    try {
      const content = await this.downloadFile(data)

      await this.add(itemId, {
        text: content,
        documentId: itemId,
        source: data.name
      })
    } catch (error) {
      ayaLogger.error(`Error processing file metadata for ${data.name}: ${error}`)
    }
  }

  private async downloadFile(file: Knowledge): Promise<string> {
    const outputPath = path.join(this.pathResolver.knowledgeRoot, file.name)

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
        ayaLogger.error(`Unsupported file type: ${fileExtension}`)
        throw new Error(`Unsupported file type: ${fileExtension}`)
      }

      const LoaderClass = loaderMap[fileExtension]

      try {
        const loader = new LoaderClass(outputPath)
        const docs = await loader.load()
        const content = docs.map((doc) => doc.pageContent).join('\n')
        ayaLogger.info(`Successfully processed file: ${file.name}`)
        return content
      } catch (error) {
        ayaLogger.error(`Error parsing ${fileExtension} file: ${file.name}`, error)
        return ''
      }
    } catch (error) {
      ayaLogger.error(`Error processing file from ${file.metadata.url}:`, error)
      throw error
    }
  }

  async add(id: UUID, knowledge: RagKnowledgeItemContent): Promise<void> {
    const agentId = this.runtime.agentId
    const checksum = calculateChecksum(knowledge.text)
    const kind = knowledge.kind

    const [item] = await this.db.select().from(Knowledges).where(eq(Knowledges.id, id))

    if (isNull(item)) {
      ayaLogger.debug(`[${kind}] knowledge=[${id}] does not exist. creating...`)
    } else if (item?.checksum === checksum) {
      ayaLogger.debug(`[${kind}] knowledge=[${id}] already exists. skipping...`)
      return
    }

    await this.db.insert(Knowledges).values({
      id,
      agentId,
      text: '',
      kind,
      source: knowledge.source,
      checksum,
      documentId: id,
      isMain: true
    })

    // Create fragments using splitChunks
    const fragments = await splitChunks(knowledge.text, 7000, 500)

    // Store each fragment with link to source document
    for (let i = 0; i < fragments.length; i++) {
      const embedding = await this.runtime.useModel(ModelType.TEXT_EMBEDDING, fragments[i])

      const fragmentId = createUniqueUuid(this, `${id}-fragment-${i}`)

      await this.db.transaction(async (tx: NodePgDatabase | PgliteDatabase) => {
        await tx.insert(Knowledges).values({
          id: fragmentId,
          agentId,
          text: fragments[i],
          kind,
          source: knowledge.source,
          documentId: id,
          isMain: false
        })

        const embeddingValues = {
          id: v4(),
          knowledgeId: fragmentId,
          createdAt: new Date()
        }

        const cleanVector = embedding.map((n) => (Number.isFinite(n) ? Number(n.toFixed(6)) : 0))

        embeddingValues[this.embeddingDimension] = cleanVector

        await tx.insert(KnowledgeEmbeddings).values(embeddingValues)
      })
    }
  }

  async list(options?: {
    limit?: number
    sort?: 'asc' | 'desc'
    cursor?: number
    filters?: {
      kind?: string
    }
  }): Promise<{ items: RAGKnowledgeItem[]; nextCursor?: number }> {
    const { limit = 100, filters, sort = 'desc', cursor } = options ?? {}

    const conditions = [eq(Knowledges.agentId, this.runtime.agentId), eq(Knowledges.isMain, true)]

    if (filters?.kind) {
      conditions.push(eq(Knowledges.kind, filters.kind))
    }

    if (cursor) {
      conditions.push(
        sort === 'desc'
          ? lt(Knowledges.createdAt, new Date(cursor))
          : gt(Knowledges.createdAt, new Date(cursor))
      )
    }

    const results = await this.db
      .select()
      .from(Knowledges)
      .where(and(...conditions))
      .orderBy(sort === 'asc' ? asc(Knowledges.createdAt) : desc(Knowledges.createdAt))
      .limit(limit)

    const items = results.map((item) => ({
      id: item.id,
      agentId: item.agentId,
      content: {
        text: item.text,
        documentId: item.documentId,
        kind: item.kind ?? undefined,
        source: item.source
      },
      embedding: [],
      createdAt: item.createdAt ? Math.floor(item.createdAt.getTime()) : undefined
    }))

    let nextCursor: number | undefined
    if (items.length === limit) {
      const lastItem = items[items.length - 1]
      nextCursor = lastItem.createdAt
    }

    return { items, nextCursor }
  }

  async search(options: {
    q: string
    limit?: number
    kind?: string
    matchThreshold?: number
  }): Promise<RAGKnowledgeItem[]> {
    const { q, limit = 10, kind, matchThreshold = 0.5 } = options
    const embedding = await this.runtime.useModel(ModelType.TEXT_EMBEDDING, q)

    const cleanVector = embedding.map((n) => (Number.isFinite(n) ? Number(n.toFixed(6)) : 0))

    const similarity = sql<number>`1 - (${cosineDistance(
      KnowledgeEmbeddings[this.embeddingDimension],
      cleanVector
    )})`

    const conditions = [
      gte(similarity, matchThreshold),
      eq(Knowledges.agentId, this.runtime.agentId)
    ]

    if (kind) {
      conditions.push(eq(Knowledges.kind, kind))
    }

    const results = await this.db
      .select({
        knowledge: Knowledges,
        similarity,
        embedding: KnowledgeEmbeddings[this.embeddingDimension]
      })
      .from(KnowledgeEmbeddings)
      .innerJoin(Knowledges, eq(KnowledgeEmbeddings.knowledgeId, Knowledges.id))
      .where(and(...conditions))
      .orderBy(desc(similarity))
      .limit(limit)

    return results.map(({ knowledge, similarity, embedding }) => ({
      id: knowledge.id,
      agentId: knowledge.agentId,
      content: {
        text: knowledge.text,
        documentId: knowledge.documentId,
        kind: knowledge.kind ?? undefined,
        source: knowledge.source
      },
      embedding: embedding ?? [],
      createdAt: knowledge.createdAt ? Math.floor(knowledge.createdAt.getTime()) : undefined,
      similarity
    }))
  }

  async get(id: UUID): Promise<RAGKnowledgeItem | undefined> {
    const [knowledge] = await this.db.select().from(Knowledges).where(eq(Knowledges.id, id))

    const [embedding] = await this.db
      .select()
      .from(KnowledgeEmbeddings)
      .where(eq(KnowledgeEmbeddings.knowledgeId, knowledge.id))

    return {
      id: knowledge.id,
      agentId: knowledge.agentId,
      content: {
        text: knowledge.text,
        documentId: knowledge.documentId,
        kind: knowledge.kind ?? undefined,
        source: knowledge.source
      },
      embedding: embedding?.[this.embeddingDimension] ?? [],
      createdAt: knowledge.createdAt ? Math.floor(knowledge.createdAt.getTime()) : undefined
    }
  }

  async remove(id: UUID): Promise<void> {
    try {
      const [knowledge] = await this.db.select().from(Knowledges).where(eq(Knowledges.id, id))

      await this.db.delete(Knowledges).where(eq(Knowledges.documentId, id))

      await fs.unlink(path.join(this.pathResolver.knowledgeRoot, knowledge.source))
    } catch (error) {
      ayaLogger.error(`Error removing knowledge: ${error}`)
    }
  }
}
