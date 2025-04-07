import { AgentRegistry } from '@/agent/registry'
import { AgentcoinAPI } from '@/apis/aya'
import { AyaAuthAPI } from '@/apis/aya-auth'
import {
  AYA_AGENT_DATA_DIR_KEY,
  AYA_AGENT_IDENTITY_KEY,
  AYA_JWT_SETTINGS_KEY,
  DOCUMENT_TABLE_NAME,
  KNOWLEDGE_TABLE_NAME
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
  ChannelType,
  createUniqueUuid,
  IAgentRuntime,
  Memory,
  MemoryType,
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
import { drizzle as drizzlePg, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { boolean, pgTable, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core'
import { drizzle, PgliteDatabase } from 'drizzle-orm/pglite'
import fs from 'fs/promises'
import { TextLoader } from 'langchain/document_loaders/fs/text'
import path from 'path'

export const Knowledges = pgTable('knowledge', {
  id: uuid('id').$type<UUID>().primaryKey(),
  agentId: uuid('agent_id').$type<UUID>().notNull(),
  text: text('text').notNull(),
  kind: text('kind').notNull(),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  isMain: boolean('is_main').default(false),
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
      const postgresUrl = this.runtime.getSetting('POSTGRES_URL')
      const pgliteDataDir = this.runtime.getSetting('PGLITE_DATA_DIR') ?? './pglite'

      if (postgresUrl) {
        const pgModule = await import('pg')
        const { Pool } = pgModule.default || pgModule
        const pool = new Pool({ connectionString: postgresUrl })
        this.db = drizzlePg(pool)
        ayaLogger.success('Connected to PostgreSQL database')
      } else {
        const { PGlite } = await import('@electric-sql/pglite')
        const pglite = new PGlite({ dataDir: pgliteDataDir })
        this.db = drizzle(pglite)
        ayaLogger.success('Connected to PGlite database')
      }

      // Create knowledge table if it doesn't exist
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS knowledge (
          id UUID PRIMARY KEY,
          agent_id UUID NOT NULL,
          text TEXT NOT NULL,
          kind TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          is_main BOOLEAN DEFAULT FALSE,
          "document_id" UUID NOT NULL
        );
      `)

      // Create knowledge_embeddings table if it doesn't exist
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS knowledge_embeddings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          knowledge_id UUID REFERENCES knowledge(id),
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
        const results = await this.runtime.getMemories({
          agentId: this.runtime.agentId,
          count: 100,
          start: cursor,
          tableName: DOCUMENT_TABLE_NAME
        })

        for (const knowledge of results) {
          if (isNull(knowledge.id)) {
            continue
          }
          existingKnowledgeIds.add(knowledge.id)
        }

        cursor = results[0]?.createdAt ? results[0].createdAt + 1 : undefined
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
        metadata: {
          type: MemoryType.DOCUMENT,
          documentId: itemId,
          source: data.name,
          timestamp: Date.now()
        }
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

  async list(options?: {
    limit?: number
    filters?: {
      kind?: string
    }
  }): Promise<RAGKnowledgeItem[]> {
    const { limit, filters } = options ?? {}

    const results = await this.runtime.getMemories({
      agentId: this.runtime.agentId,
      count: limit,
      tableName: DOCUMENT_TABLE_NAME,
      roomId: filters?.kind ? this.getRoomId(filters.kind) : undefined
    })

    return results.map(this.convertToRAGKnowledgeItem)
  }

  async search(options: {
    q: string
    limit: number
    kind?: string
    matchThreshold?: number
  }): Promise<RAGKnowledgeItem[]> {
    const { q, limit, kind, matchThreshold = 0.5 } = options

    const results = await this.runtime.searchMemories({
      embedding: await this.runtime.useModel(ModelType.TEXT_EMBEDDING, q),
      match_threshold: matchThreshold,
      count: limit,
      tableName: KNOWLEDGE_TABLE_NAME,
      // Q: should this be undefined or <unknown> i.e do we get all the results or only <unknown>
      roomId: kind ? this.getRoomId(kind) : undefined
    })

    return results.map(this.convertToRAGKnowledgeItem)
  }

  async get(id: UUID): Promise<RAGKnowledgeItem | undefined> {
    const result = await this.runtime.getMemoryById(id)

    return result ? this.convertToRAGKnowledgeItem(result) : undefined
  }

  async add(id: UUID, knowledge: RagKnowledgeItemContent): Promise<void> {
    const agentId = this.runtime.agentId
    const checksum = calculateChecksum(knowledge.text)
    const kind = knowledge.kind

    const item = await this.runtime.getMemoryById(id)
    const storedKB = item ? this.convertToRAGKnowledgeItem(item) : undefined

    if (isNull(storedKB)) {
      ayaLogger.debug(`[${kind}] knowledge=[${id}] does not exist. creating...`)
    } else if (storedKB?.content.metadata?.checksum === checksum) {
      ayaLogger.debug(`[${kind}] knowledge=[${id}] already exists. skipping...`)
      return
    }

    const roomId = this.getRoomId(kind ?? '<unknown>')

    const existingRoom = await this.runtime.getRoom(roomId)
    if (isNull(existingRoom)) {
      await this.runtime.createRoom({
        id: roomId,
        name: `${agentId}:knowledge`,
        source: 'knowledge',
        type: ChannelType.SELF
      })
    }

    const documentMemory: Memory = {
      id,
      agentId,
      roomId,
      entityId: agentId,
      content: {
        text: ''
      },
      metadata: {
        ...knowledge.metadata,
        type: MemoryType.DOCUMENT,
        checksum
      }
    }

    await this.runtime.createMemory(documentMemory, DOCUMENT_TABLE_NAME)

    // Create fragments using splitChunks
    const fragments = await splitChunks(knowledge.text, 7000, 500)

    // Store each fragment with link to source document
    for (let i = 0; i < fragments.length; i++) {
      const embedding = await this.runtime.useModel(ModelType.TEXT_EMBEDDING, fragments[i])
      const fragmentMemory: Memory = {
        id: createUniqueUuid(this, `${id}-fragment-${i}`),
        agentId,
        roomId,
        entityId: agentId,
        embedding,
        content: { text: fragments[i] },
        metadata: {
          type: MemoryType.FRAGMENT,
          documentId: id, // Link to source document
          position: i, // Keep track of order
          timestamp: Date.now(),
          source: knowledge.metadata?.source
        }
      }

      await this.runtime.createMemory(fragmentMemory, KNOWLEDGE_TABLE_NAME)
    }
  }

  async remove(id: UUID): Promise<void> {
    const knowledge = (await this.runtime.getMemoriesByIds([id]))[0]
    if (isNull(knowledge)) {
      ayaLogger.debug(`Knowledge item [${id}] not found. skipping...`)
      return
    }

    await this.runtime.deleteMemory(id)

    // FIXME: delete all fragments, can possibly use worldId to group all rooms and delete them

    if (knowledge.metadata?.source) {
      await fs.unlink(path.join(this.pathResolver.knowledgeRoot, knowledge.metadata.source))
    }
  }

  private convertToRAGKnowledgeItem(result: Memory): RAGKnowledgeItem {
    if (isNull(result.id) || isNull(result.agentId)) {
      throw new Error('Invalid result')
    }

    return {
      id: result.id,
      agentId: result.agentId,
      content: {
        ...result.content,
        text: result.content.text ?? ''
      },
      embedding: result.embedding ?? [],
      createdAt: result.createdAt,
      similarity: result.similarity
    }
  }

  private getRoomId(kind: string): UUID {
    return stringToUuid(`${this.runtime.agentId}:${kind}`)
  }
}
