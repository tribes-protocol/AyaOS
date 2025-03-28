import { IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import { RAGKnowledgeManager } from '@elizaos/core'

export class AyaRAGKnowledgeManager extends RAGKnowledgeManager {
  constructor(opts: { tableName: string; runtime: IAyaRuntime; knowledgeRoot: string }) {
    super(opts)
    ayaLogger.info(`[Cleanup] Knowledge root path: ${this.knowledgeRoot}`)
  }

  async cleanupDeletedKnowledgeFiles(): Promise<void> {
    // noop
  }
}
