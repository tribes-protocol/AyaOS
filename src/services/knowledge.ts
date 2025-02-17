import { FileMetadata, FileMetadataSchema } from '@/common/types'
import { embed, IAgentRuntime, splitChunks, stringToUuid, UUID } from '@elizaos/core'
import axios from 'axios'
import fs from 'fs/promises'
import mammoth from 'mammoth'
import path from 'path'
import pdfParse from 'pdf-parse'

export class KnowledgeService {
  private stopSignal = false
  constructor(
    private readonly outputDirectory: string,
    private readonly runtime: IAgentRuntime
  ) {}

  async startIndexing(jsonDirectory: string): Promise<void> {
    console.log('📌 Knowledge indexing job started...')

    const gracefulShutdown = (): void => {
      console.log('🔴 Graceful shutdown initiated...')
      this.stopSignal = true
    }

    process.on('SIGINT', gracefulShutdown)
    process.on('SIGTERM', gracefulShutdown)

    while (!this.stopSignal) {
      try {
        await this.processJsonFiles(jsonDirectory)
      } catch (error) {
        console.error('⚠️ Error in indexing job:', error)
      }

      // Wait for 1 minute before the next run
      await new Promise((resolve) => setTimeout(resolve, 60_000))
    }

    console.log('✅ Indexing job stopped gracefully.')
  }

  async processJsonFiles(jsonDirectory: string): Promise<void> {
    try {
      const files = (await fs.readdir(jsonDirectory)).filter((file) => file.endsWith('.json'))

      for (const jsonFile of files) {
        const filePath = path.join(jsonDirectory, jsonFile)
        const metadata = await fs.readFile(filePath, 'utf-8')

        let data: FileMetadata
        try {
          data = FileMetadataSchema.parse(JSON.parse(metadata))
        } catch (error) {
          console.error(`Invalid JSON format in ${jsonFile}:`, error)
          continue
        }

        const itemId = stringToUuid(jsonFile)
        const existingKnowledge = await this.runtime.databaseAdapter.getKnowledge({
          id: itemId,
          agentId: this.runtime.agentId
        })

        if (data.action === 'delete') {
          if (existingKnowledge.length > 0) {
            await this.runtime.databaseAdapter.removeKnowledge(itemId)
          }
          continue
        }

        if (existingKnowledge.length > 0) {
          continue
        }

        await this.processFileMetadata(data, itemId)
      }
    } catch (error) {
      console.error('Error processing JSON files:', error)
      throw error
    }
  }

  private async processFileMetadata(data: FileMetadata, itemId: UUID): Promise<void> {
    try {
      const content = await this.downloadFile(data)
      const preprocessedContent = this.preprocess(content)

      const mainEmbeddingArray = await embed(this.runtime, preprocessedContent)
      const mainEmbedding = new Float32Array(mainEmbeddingArray)

      await this.runtime.databaseAdapter.createKnowledge({
        id: itemId,
        agentId: this.runtime.agentId,
        content: {
          text: preprocessedContent,
          metadata: { source: 'file', isMain: true }
        },
        embedding: mainEmbedding,
        createdAt: Date.now()
      })

      const chunks = await splitChunks(preprocessedContent, 750, 75)

      await Promise.all(
        chunks.map(async (chunk, index) => {
          const chunkEmbeddingArray = await embed(this.runtime, chunk)
          const chunkEmbedding = new Float32Array(chunkEmbeddingArray)

          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          const chunkId = `${itemId}-chunk-${index}` as UUID

          await this.runtime.databaseAdapter.createKnowledge({
            id: chunkId,
            agentId: this.runtime.agentId,
            content: {
              text: chunk,
              metadata: { isChunk: true, source: 'file', originalId: itemId, chunkIndex: index }
            },
            embedding: chunkEmbedding,
            createdAt: Date.now()
          })
        })
      )
    } catch (error) {
      console.error(`Error processing file metadata for ${data.filename}:`, error)
    }
  }

  private async downloadFile(file: FileMetadata): Promise<string> {
    await fs.mkdir(this.outputDirectory, { recursive: true })
    const outputPath = path.join(this.outputDirectory, file.filename)

    try {
      const response = await axios({
        method: 'GET',
        url: file.url,
        responseType: 'arraybuffer'
      })

      await fs.writeFile(outputPath, response.data)

      let content = ''
      const fileExtension = path.extname(file.filename).toLowerCase()

      switch (fileExtension) {
        case '.txt':
        case '.csv':
        case '.md': {
          content = await fs.readFile(outputPath, 'utf-8')
          break
        }
        case '.pdf': {
          try {
            const dataBuffer = await fs.readFile(outputPath)
            const pdfData = await pdfParse(dataBuffer)
            content = pdfData.text
          } catch (error) {
            console.error(`Error parsing PDF file: ${file.filename}`, error)
          }
          break
        }
        case '.docx': {
          try {
            const result = await mammoth.extractRawText({ path: outputPath })
            content = result.value
          } catch (error) {
            console.error(`Error parsing DOC/DOCX file: ${file.filename}`, error)
          }
          break
        }
        default:
          console.warn(`Unsupported file type: ${fileExtension}`)
          break
      }

      console.log(`Successfully processed file: ${file.filename}`)
      return content
    } catch (error) {
      console.error(`Error processing file from ${file.url}:`, error)
      throw error
    } finally {
      await fs.unlink(outputPath).catch(() => {
        console.warn(`Failed to delete file: ${outputPath}`)
      })
    }
  }

  private preprocess(content: string): string {
    if (!content || typeof content !== 'string') {
      console.warn('Invalid input for preprocessing')
      return ''
    }

    return content
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`.*?`/g, '')
      .replace(/#{1,6}\s*(.*)/g, '$1')
      .replace(/!\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1')
      .replace(/<@[!&]?\d+>/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/^\s*[-*_]{3,}\s*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .toLowerCase()
  }
}
