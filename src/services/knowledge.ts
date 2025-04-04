import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { DOCUMENT_TABLE_NAME, KNOWLEDGE_TABLE_NAME } from '@/common/constants'
import { calculateChecksum, isNull } from '@/common/functions'
import { IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import { PathResolver } from '@/common/path-resolver'
import {
  Identity,
  Knowledge,
  RAGKnowledgeItem,
  RagKnowledgeItemContent,
  ServiceKind
} from '@/common/types'
import { IKnowledgeService } from '@/services/interfaces'
import {
  createUniqueUuid,
  Memory,
  MemoryType,
  ModelType,
  Service,
  splitChunks,
  stringToUuid,
  UUID
} from '@elizaos/core'
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import axios from 'axios'
import fs from 'fs/promises'
import { TextLoader } from 'langchain/document_loaders/fs/text'
import path from 'path'

export class KnowledgeService extends Service implements IKnowledgeService {
  private isRunning = false

  readonly serviceType = ServiceKind.knowledge
  readonly capabilityDescription = ''

  private constructor(
    readonly runtime: IAyaRuntime,
    private readonly agentCoinApi: AgentcoinAPI,
    private readonly agentCoinCookie: string,
    private readonly agentCoinIdentity: Identity,
    private readonly pathResolver: PathResolver
  ) {
    super(undefined)
  }

  static getInstance(
    runtime: IAyaRuntime,
    agentCoinApi: AgentcoinAPI,
    agentCoinCookie: string,
    agentCoinIdentity: Identity,
    pathResolver: PathResolver
  ): IKnowledgeService {
    if (isNull(instance)) {
      instance = new KnowledgeService(
        runtime,
        agentCoinApi,
        agentCoinCookie,
        agentCoinIdentity,
        pathResolver
      )
    }
    return instance
  }

  private async start(): Promise<void> {
    if (this.isRunning) {
      return
    }

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

  static async start(_runtime: IAyaRuntime): Promise<Service> {
    if (isNull(instance)) {
      throw new Error('KnowledgeService not initialized')
    }
    // don't await this. it'll lock up the main process
    void instance.start()
    return instance
  }

  static async stop(_runtime: IAyaRuntime): Promise<unknown> {
    if (isNull(instance)) {
      throw new Error('ConfigService not initialized')
    }
    await instance.stop()
    return instance
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

    ayaLogger.debug(`Found ${allKnowledge.length} knowledges`)

    return allKnowledge
  }

  private async syncKnowledge(): Promise<void> {
    ayaLogger.debug('Syncing knowledge...')
    try {
      const knowledges = await this.getAllKnowledge()

      const existingKnowledgeIds = new Set<UUID>()

      let cursor: number | undefined
      let i = 0
      do {
        const results = await this.runtime.getMemories({
          agentId: this.runtime.agentId,
          count: 100,
          start: cursor,
          tableName: DOCUMENT_TABLE_NAME
        })

        ayaLogger.debug(`Found ${results.length} knowledge items in page ${i++}`)

        for (const knowledge of results) {
          if (isNull(knowledge.id)) {
            continue
          }
          existingKnowledgeIds.add(knowledge.id)
        }

        cursor = results[results.length - 1].createdAt
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

      ayaLogger.debug(
        `Knowledge sync completed: ${remoteKnowledgeIds.length} remote items, ` +
          `${knowledgeIdsToRemove.length} items removed`
      )
    } catch (error) {
      if (error instanceof Error) {
        ayaLogger.error('Error processing knowledge files:', error.message)
      } else {
        ayaLogger.error('Error processing knowledge files:', error)
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
      ayaLogger.error(`Error processing file metadata for ${data.name}:`, error)
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
    sort?: 'asc' | 'desc'
    filters?: {
      isChunk?: boolean
      source?: string
      kind?: string
    }
  }): Promise<RAGKnowledgeItem[]> {
    // FIXME: avp how to add filters and sort
    const { limit } = options ?? {}

    const results = await this.runtime.getMemories({
      agentId: this.runtime.agentId,
      count: limit,
      tableName: KNOWLEDGE_TABLE_NAME
    })

    return results.map(this.convertToRAGKnowledgeItem)
  }

  async search(options: {
    q: string
    limit: number
    matchThreshold?: number
  }): Promise<RAGKnowledgeItem[]> {
    const { q, limit, matchThreshold = 0.5 } = options

    const results = await this.runtime.searchMemories({
      embedding: await this.runtime.useModel(ModelType.TEXT_EMBEDDING, q),
      match_threshold: matchThreshold,
      count: limit,
      tableName: KNOWLEDGE_TABLE_NAME
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
    const kind = knowledge.metadata?.kind ?? '<unknown>'

    const item = await this.runtime.getMemoryById(id)
    const storedKB = item ? this.convertToRAGKnowledgeItem(item) : undefined

    if (isNull(storedKB)) {
      ayaLogger.debug(`[${kind}] knowledge=[${id}] does not exist. creating...`)
    } else if (storedKB?.content.metadata?.checksum === checksum) {
      ayaLogger.debug(`[${kind}] knowledge=[${id}] already exists. skipping...`)
      return
    }

    const roomId = stringToUuid(`${agentId}-${id}`)

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
          timestamp: Date.now()
        }
      }

      await this.runtime.createMemory(fragmentMemory, KNOWLEDGE_TABLE_NAME)
    }
  }

  async remove(id: UUID): Promise<void> {
    const roomId = stringToUuid(`${this.runtime.agentId}-${id}`)

    const knowledge = await this.runtime.getMemoryById(id)
    if (isNull(knowledge)) {
      ayaLogger.debug(`Knowledge item [${id}] not found. skipping...`)
      return
    }

    await Promise.all([
      this.runtime.deleteAllMemories(roomId, KNOWLEDGE_TABLE_NAME),
      this.runtime.deleteAllMemories(roomId, DOCUMENT_TABLE_NAME)
    ])

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
}

let instance: KnowledgeService | undefined
