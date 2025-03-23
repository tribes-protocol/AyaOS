import { isNull } from '@/common/functions'
import { IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import { IAyaDatabaseAdapter } from '@/databases/interfaces'
import { RAGKnowledgeItem, RAGKnowledgeManager } from '@elizaos/core'
import { existsSync } from 'fs'
import { join } from 'path'

export class AyaRAGKnowledgeManager extends RAGKnowledgeManager {
  private readonly databaseAdapter: IAyaDatabaseAdapter

  constructor(opts: { tableName: string; runtime: IAyaRuntime; knowledgeRoot: string }) {
    super(opts)
    this.databaseAdapter = opts.runtime.databaseAdapter
    ayaLogger.info(`[Cleanup] Knowledge root path: ${this.knowledgeRoot}`)
  }

  async cleanupDeletedKnowledgeFiles(): Promise<void> {
    try {
      ayaLogger.debug('[Cleanup] Starting knowledge cleanup process, agent: ', this.runtime.agentId)

      // Use fetchKnowledge with paging instead of listAllKnowledge
      let parentDocuments: RAGKnowledgeItem[] = []
      let cursor: string | undefined

      do {
        const response = await this.databaseAdapter.fetchKnowledge({
          agentId: this.runtime.agentId,
          cursor,
          filters: {
            isChunk: false // Only fetch parent documents, not chunks
          }
        })

        // Filter documents that have a source path
        const documentsWithSource = response.results.filter((item) => item.content.metadata?.source)

        parentDocuments = [...parentDocuments, ...documentsWithSource]
        cursor = response.cursor
      } while (cursor)

      ayaLogger.debug(`[Cleanup] Found ${parentDocuments.length} parent documents to check`)

      for (const item of parentDocuments) {
        const relativePath = item.content.metadata?.source
        if (isNull(relativePath)) continue // Skip if no source path

        const filePath = join(this.knowledgeRoot, relativePath)

        ayaLogger.debug(`[Cleanup] Checking joined file path: ${filePath}`)

        if (!existsSync(filePath)) {
          ayaLogger.warn(`[Cleanup] File not found, starting removal process: ${filePath}`)

          const idToRemove = item.id
          ayaLogger.debug(`[Cleanup] Using ID for removal: ${idToRemove}`)

          try {
            // Just remove the parent document - this will cascade to chunks
            await this.removeKnowledge(idToRemove)

            ayaLogger.success(`[Cleanup] Successfully removed knowledge for file: ${filePath}`)
          } catch (deleteError) {
            ayaLogger.error(`[Cleanup] Error during deletion process for ${filePath}:`, deleteError)
          }
        }
      }

      ayaLogger.debug('[Cleanup] Finished knowledge cleanup process')
    } catch (error) {
      ayaLogger.error('[Cleanup] Error cleaning up deleted knowledge files:', error)
    }
  }
}
