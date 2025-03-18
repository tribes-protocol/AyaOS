import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { AgentcoinRuntime } from '@/common/runtime'
import { Identity, Knowledge, ServiceKind } from '@/common/types'
import {
  elizaLogger,
  embed,
  getEmbeddingZeroVector,
  IAgentRuntime,
  RAGKnowledgeManager,
  Service,
  ServiceType,
  splitChunks,
  stringToUuid,
  UUID
} from '@elizaos/core'
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import axios from 'axios'
import crypto from 'crypto'
import fs from 'fs/promises'
import { TextLoader } from 'langchain/document_loaders/fs/text'

import path from 'path'

export class KnowledgeService extends Service {
  private readonly knowledgeRoot: string
  private isRunning = false

  static get serviceType(): ServiceType {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ServiceKind.knowledge as unknown as ServiceType
  }

  async initialize(_: IAgentRuntime): Promise<void> {}

  constructor(
    private readonly runtime: AgentcoinRuntime,
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
        this.runtime.databaseAdapter.getKnowledge({
          agentId: this.runtime.agentId
        })
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

        await this.runtime.databaseAdapter.removeKnowledge(knowledge.id)
        if (knowledge.content.metadata?.source) {
          await fs.unlink(path.join(this.knowledgeRoot, knowledge.content.metadata?.source))
        }

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

      await this.runtime.databaseAdapter.createKnowledge({
        id: itemId,
        agentId: this.runtime.agentId,
        content: {
          text: '',
          metadata: { source: data.name }
        },
        embedding: new Float32Array(getEmbeddingZeroVector()),
        createdAt: Date.now()
      })

      const chunks = await splitChunks(content, 750, 250)

      await Promise.all(
        chunks.map(async (chunk, index) => {
          const chunkEmbeddingArray = await embed(this.runtime, chunk)
          const chunkEmbedding = new Float32Array(chunkEmbeddingArray)

          const md5Hash = crypto.createHash('md5').update(`${itemId}-chunk-${index}`).digest('hex')
          const chunkId: UUID = `${md5Hash}-chunk-chunk-chunk-${index}`

          await this.runtime.databaseAdapter.createKnowledge({
            id: chunkId,
            agentId: this.runtime.agentId,
            content: {
              text: chunk,
              metadata: {
                isChunk: true,
                source: data.name,
                originalId: itemId,
                chunkIndex: index
              }
            },
            embedding: chunkEmbedding,
            createdAt: Date.now()
          })
        })
      )
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
}
