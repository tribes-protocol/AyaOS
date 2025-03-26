// import { AgentcoinAPI } from '@/apis/agentcoinfun'
// import { calculateChecksum, isNull } from '@/common/functions'
// import { IAyaRuntime } from '@/common/iruntime'
// import { ayaLogger } from '@/common/logger'
// import { Identity, Knowledge, RagKnowledgeItemContent, ServiceKind } from '@/common/types'
// import { IKnowledgeService } from '@/services/interfaces'
// import { Service, stringToUuid, UUID } from '@elizaos/core'
// import { CSVLoader } from '@langchain/community/document_loaders/fs/csv'
// import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
// import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
// import axios from 'axios'
// import fs from 'fs/promises'
// import { TextLoader } from 'langchain/document_loaders/fs/text'
// import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
// import path from 'path'
// import { RAGKnowledgeItem } from '..'

// const AGENTCOIN_SOURCE = 'agentcoin'

// export class KnowledgeService extends Service implements IKnowledgeService {
//   private isRunning = false
//   private readonly textSplitter = new RecursiveCharacterTextSplitter({
//     chunkSize: 7000, // text-embedding-ada-002 has a max token limit of ~8000
//     chunkOverlap: 500,
//     separators: ['\n## ', '\n### ', '\n#### ', '\n', ' ', '']
//   })

//   static get serviceType(): string {
//     return ServiceKind.knowledge
//   }

//   constructor(
//     private readonly runtime: IAyaRuntime,
//     private readonly agentCoinApi: AgentcoinAPI,
//     private readonly agentCoinCookie: string,
//     private readonly agentCoinIdentity: Identity
//   ) {
//     super(runtime)
//   }

//   async start(): Promise<void> {
//     if (this.isRunning) {
//       return
//     }

//     this.isRunning = true
//     while (this.isRunning) {
//       try {
//         await this.syncKnowledge()
//       } catch (error) {
//         if (error instanceof Error) {
//           ayaLogger.error('⚠️ Error in sync job:', error.message)
//         } else {
//           ayaLogger.error('⚠️ Error in sync job:', error)
//         }
//       }
//       // Wait for 1 minute before the next run
//       await new Promise((resolve) => setTimeout(resolve, 60_000))
//     }
//     ayaLogger.success('Sync job stopped gracefully.')
//   }

//   async stop(): Promise<void> {
//     this.isRunning = false
//     ayaLogger.info('Knowledge sync service stopped')
//   }

//   private async getAllKnowledge(): Promise<Knowledge[]> {
//     const allKnowledge: Knowledge[] = []
//     let cursor = 0
//     const limit = 100

//     while (true) {
//       const knowledges = await this.agentCoinApi.getKnowledges(this.agentCoinIdentity, {
//         cookie: this.agentCoinCookie,
//         limit,
//         cursor
//       })

//       allKnowledge.push(...knowledges)

//       if (knowledges.length < limit) {
//         break
//       }

//       cursor = knowledges[knowledges.length - 1].id
//     }

//     ayaLogger.debug(`Found ${allKnowledge.length} knowledges`)

//     return allKnowledge
//   }

//   private async syncKnowledge(): Promise<void> {
//     ayaLogger.debug('Syncing knowledge...')
//     try {
//       const knowledges = await this.getAllKnowledge()

//       // Use fetchKnowledge with filtering by source and isChunk
//       const existingKnowledgeIds = new Set<UUID>()

//       // Fetch parent knowledge items with source=agentcoin directly using database filters
//       let cursor: string | undefined
//       let i = 0
//       do {
//   const { results, cursor: nextCursor } = await this.runtime.databaseAdapter.fetchKnowledge({
//           agentId: this.runtime.agentId,
//           limit: 100,
//           cursor,
//           filters: {
//             isChunk: false,
//             source: AGENTCOIN_SOURCE
//           }
//         })

//         ayaLogger.debug(
//           `Found ${AGENTCOIN_SOURCE} ${results.length} knowledge items in page ${i++}`
//         )

//         // Add their IDs to the set (no filtering needed anymore as it's done at DB level)
//         for (const knowledge of results) {
//           existingKnowledgeIds.add(knowledge.id)
//         }

//         cursor = nextCursor
//       } while (cursor)

//       const remoteKnowledgeIds: UUID[] = []
//       for (const knowledge of knowledges) {
//         const itemId = stringToUuid(knowledge.metadata.url)
//         remoteKnowledgeIds.push(itemId)

//         if (!existingKnowledgeIds.has(itemId)) {
//           ayaLogger.info(`Processing new knowledge: ${knowledge.name}`)
//           await this.processFileKnowledge(knowledge, itemId)
//         }
//       }

//       // Find IDs to remove by filtering existing IDs not present in remote IDs
//       const knowledgeIdsToRemove = Array.from(existingKnowledgeIds).filter(
//         (id) => !remoteKnowledgeIds.includes(id)
//       )

//       for (const knowledgeId of knowledgeIdsToRemove) {
//         ayaLogger.info(`Removing knowledge: ${knowledgeId}`)
//         await this.remove(knowledgeId)
//       }

//       await this.runtime.ragKnowledgeManager.cleanupDeletedKnowledgeFiles()
//       ayaLogger.debug(
//         `Knowledge sync completed: ${remoteKnowledgeIds.length} remote items, ` +
//           `${knowledgeIdsToRemove.length} items removed`
//       )
//     } catch (error) {
//       if (error instanceof Error) {
//         ayaLogger.error('Error processing knowledge files:', error.message)
//       } else {
//         ayaLogger.error('Error processing knowledge files:', error)
//       }
//       throw error
//     }
//   }

//   private async processFileKnowledge(data: Knowledge, itemId: UUID): Promise<void> {
//     try {
//       const content = await this.downloadFile(data)

//       await this.add(itemId, {
//         text: content,
//         metadata: {
//           source: AGENTCOIN_SOURCE
//         }
//       })
//     } catch (error) {
//       ayaLogger.error(`Error processing file metadata for ${data.name}:`, error)
//     }
//   }

//   private async downloadFile(file: Knowledge): Promise<string> {
//     await fs.mkdir(this.knowledgeRoot, { recursive: true })
//     const outputPath = path.join(this.knowledgeRoot, file.name)

//     try {
//       const response = await axios({
//         method: 'GET',
//         url: file.metadata.url,
//         responseType: 'arraybuffer'
//       })

//       await fs.writeFile(outputPath, response.data)

//       const loaderMap = {
//         '.txt': TextLoader,
//         '.md': TextLoader,
//         '.csv': CSVLoader,
//         '.pdf': PDFLoader,
//         '.docx': DocxLoader
//       } as const

//       const isValidFileExtension = (ext: string): ext is keyof typeof loaderMap => {
//         return ext in loaderMap
//       }

//       const fileExtension = path.extname(file.name).toLowerCase()
//       if (!isValidFileExtension(fileExtension)) {
//         ayaLogger.error(`Unsupported file type: ${fileExtension}`)
//         throw new Error(`Unsupported file type: ${fileExtension}`)
//       }

//       const LoaderClass = loaderMap[fileExtension]

//       try {
//         const loader = new LoaderClass(outputPath)
//         const docs = await loader.load()
//         const content = docs.map((doc) => doc.pageContent).join('\n')
//         ayaLogger.info(`Successfully processed file: ${file.name}`)
//         return content
//       } catch (error) {
//         ayaLogger.error(`Error parsing ${fileExtension} file: ${file.name}`, error)
//         return ''
//       }
//     } catch (error) {
//       ayaLogger.error(`Error processing file from ${file.metadata.url}:`, error)
//       throw error
//     }
//   }

//   async list(options?: {
//     limit?: number
//     sort?: 'asc' | 'desc'
//     filters?: {
//       isChunk?: boolean
//       source?: string
//       kind?: string
//     }
//   }): Promise<RAGKnowledgeItem[]> {
//     const { limit, filters, sort } = options ?? {}

//     // Use fetchKnowledge which supports filters instead of getKnowledge
//     const { results } = await this.runtime.databaseAdapter.fetchKnowledge({
//       agentId: this.runtime.agentId,
//       limit,
//       filters,
//       sort
//     })

//     return results
//   }

//   async search(options: {
//     q: string
//     limit: number
//     matchThreshold?: number
//   }): Promise<RAGKnowledgeItem[]> {
//     const { q, limit, matchThreshold = 0.5 } = options
//     return this.runtime.databaseAdapter.searchKnowledge({
//       agentId: this.runtime.agentId,
//       embedding: new Float32Array(await embed(this.runtime, q)),
//       match_threshold: matchThreshold,
//       match_count: limit
//     })
//   }

//   async get(id: UUID): Promise<RAGKnowledgeItem | undefined> {
//     const knowledge = await this.runtime.databaseAdapter.getKnowledge({
//       agentId: this.runtime.agentId,
//       id,
//       limit: 1
//     })
//     return knowledge[0]
//   }

//   async add(id: UUID, knowledge: RagKnowledgeItemContent): Promise<void> {
//     const databaseAdapter = this.runtime.databaseAdapter
//     const agentId = this.runtime.agentId
//     const checksum = calculateChecksum(knowledge.text)
//     const kind = knowledge.metadata?.kind ?? '<unknown>'
//     const storedKB: RAGKnowledgeItem | undefined = (
//       await databaseAdapter.getKnowledge({
//         id,
//         agentId,
//         limit: 1
//       })
//     )[0]

//     if (isNull(storedKB)) {
//       ayaLogger.debug(`[${kind}] knowledge=[${id}] does not exist. creating...`)
//     } else if (storedKB?.content.metadata?.checksum === checksum) {
//       ayaLogger.debug(`[${kind}] knowledge=[${id}] already exists. skipping...`)
//       return
//     }

//     // create main knowledge item
//     const knowledgeItem: RAGKnowledgeItem = {
//       id,
//       agentId,
//       content: {
//         text: '',
//         metadata: {
//           ...Object.fromEntries(
//             Object.entries(knowledge.metadata || {}).filter(([_, v]) => v !== null)
//           ),
//           isMain: true,
//           isChunk: false,
//           originalId: undefined,
//           chunkIndex: undefined,
//           checksum
//         }
//       },
//       embedding: new Float32Array(getEmbeddingZeroVector()),
//       createdAt: Date.now()
//     }

//     // delete old knowledge item
//     if (storedKB) {
//       await databaseAdapter.removeKnowledge(id)
//     }

//     // create main knowledge item
//     await databaseAdapter.createKnowledge(knowledgeItem)

//     // Split the content into chunks
//     const chunks = await this.textSplitter.createDocuments([knowledge.text])
//     for (let i = 0; i < chunks.length; i++) {
//       const chunk = chunks[i]
//       const chunkId: UUID = stringToUuid(`${id}-${i}`)

//       ayaLogger.info(`processing chunk id=${chunkId} page=${i} id=${id} kind=${kind}`)

//       const embeddings = await embed(this.runtime, chunk.pageContent)
//       const knowledgeItem: RAGKnowledgeItem = {
//         id: chunkId,
//         agentId,
//         content: {
//           text: chunk.pageContent,
//           metadata: {
//             ...Object.fromEntries(
//               Object.entries(knowledge.metadata || {}).filter(([_, v]) => v !== null)
//             ),
//             isMain: false,
//             isChunk: true,
//             originalId: id,
//             chunkIndex: i,
//             source: undefined,
//             kind,
//             checksum
//           }
//         },
//         embedding: new Float32Array(embeddings),
//         createdAt: Date.now()
//       }

//       await databaseAdapter.createKnowledge(knowledgeItem)
//     }
//   }

//   async remove(id: UUID): Promise<void> {
//     await this.runtime.databaseAdapter.removeKnowledge(id)
//   }

//   static async start(_runtime: IAyaRuntime): Promise<Service> {
//     return new KnowledgeService(_runtime)
//   }

//   static async stop(_runtime: IAyaRuntime): Promise<unknown> {
//     return undefined
//   }
// }
