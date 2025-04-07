import { AyaAuthAPI } from '@/apis/aya-auth'
import { AYA_AGENT_IDENTITY_KEY, AYA_JWT_SETTINGS_KEY } from '@/common/constants'
import { ensureStringSetting, isNull } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import {
  AgentIdentitySchema,
  Identity,
  RAGKnowledgeItem,
  RagKnowledgeItemContent
} from '@/common/types'
import { IKnowledgeService } from '@/services/interfaces'
import { IAgentRuntime, Service, UUID } from '@elizaos/core'

export class KnowledgeService extends Service implements IKnowledgeService {
  static readonly instances = new Map<UUID, KnowledgeService>()
  private isRunning = false

  static readonly serviceType = 'aya-os-knowledge-service'
  readonly capabilityDescription = ''
  private readonly authAPI: AyaAuthAPI
  private readonly identity: Identity

  constructor(readonly runtime: IAgentRuntime) {
    super(runtime)
    const token = ensureStringSetting(runtime, AYA_JWT_SETTINGS_KEY)
    const identity = ensureStringSetting(runtime, AYA_AGENT_IDENTITY_KEY)
    this.authAPI = new AyaAuthAPI(token)
    this.identity = AgentIdentitySchema.parse(identity)
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

  static async start(_runtime: IAgentRuntime): Promise<Service> {
    let instance = KnowledgeService.instances.get(_runtime.agentId)
    if (instance) {
      return instance
    }
    instance = new KnowledgeService(_runtime)
    KnowledgeService.instances.set(_runtime.agentId, instance)
    // don't await this. it'll lock up the main process
    void instance.start()
    return instance
  }

  static async stop(_runtime: IAgentRuntime): Promise<unknown> {
    const instance = KnowledgeService.instances.get(_runtime.agentId)
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

    ayaLogger.info(`Found ${allKnowledge.length} knowledges`)

    return allKnowledge
  }

  private async syncKnowledge(): Promise<void> {
    ayaLogger.info('Syncing knowledge...')
    try {
      ayaLogger.info('Getting all knowledges...')
      const knowledges = await this.getAllKnowledge()
      ayaLogger.info(`Found ${knowledges.length} knowledges`)
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

        ayaLogger.info(`Found ${results.length} knowledge items in page ${i++}`)

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

      ayaLogger.info(
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
