import { ensure, isNull } from '@/common/functions'
// import { KnowledgeService } from '@/services/knowledge'
import { IAyaRuntime, ServiceLike } from '@/common/iruntime'
import { PathResolver } from '@/common/path-resolver'
import {
  AgentRuntime,
  Character,
  IDatabaseAdapter,
  Plugin,
  Service,
  ServiceTypeName,
  UUID
} from '@elizaos/core'

export class AyaRuntime extends AgentRuntime implements IAyaRuntime {
  public readonly pathResolver: PathResolver
  public constructor(opts: {
    eliza: {
      conversationLength?: number
      agentId?: UUID
      character?: Character
      plugins?: Plugin[]
      fetch?: typeof fetch
      adapter?: IDatabaseAdapter
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events?: { [key: string]: ((params: any) => void)[] }
      ignoreBootstrap?: boolean
    }
    pathResolver: PathResolver
  }) {
    if (opts.eliza.character) {
      if (isNull(opts.eliza.character.plugins)) {
        opts.eliza.character.plugins = []
      }

      // Ensure Twitter plugin is included
      if (!opts.eliza.character.plugins.includes('@elizaos/plugin-twitter')) {
        opts.eliza.character.plugins.push('@elizaos/plugin-twitter')
      }

      // Ensure Discord plugin is included
      if (!opts.eliza.character.plugins.includes('@elizaos/plugin-discord')) {
        opts.eliza.character.plugins.push('@elizaos/plugin-discord')
      }

      // Ensure sql plugin is included
      if (!opts.eliza.character.plugins.includes('@elizaos/plugin-sql')) {
        opts.eliza.character.plugins.push('@elizaos/plugin-sql')
      }

      // FIXME: hish - need to add a plugin for the agentcoin and farcaster
    }

    super({ ...opts.eliza })
    this.pathResolver = opts.pathResolver
    // // 😈 hacky way to set the knowledge root
    // // eslint-disable-next-line
    // ;(this as any).knowledgeRoot = this.pathResolver.knowledgeRoot

    // this.ragKnowledgeManager = new AyaRAGKnowledgeManager({
    //   runtime: this,
    //   tableName: 'knowledge',
    //   knowledgeRoot: this.pathResolver.knowledgeRoot
    // })
  }

  getService<T extends Service>(service: ServiceLike): T | null {
    // Handle existing case where ServiceType or string is passed
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return super.getService(service as ServiceTypeName) as T
  }

  ensureService<T extends Service>(service: ServiceLike, message?: string): T {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ensure(this.getService(service), message) as T
  }

  ensureSetting(key: string, message?: string): string {
    return ensure(super.getSetting(key), message)
  }

  // async composeState(
  //   message: Memory,
  //   additionalKeys?: {
  //     [key: string]: unknown
  //   }
  // ): Promise<State> {
  //   const state = await super.composeState(message, additionalKeys)

  //   // don't do anything if the message is from the agent to itself
  //   if (message.userId === this.agentId) {
  //     return state
  //   }

  //   // Since ElizaOS rag knowledge is currently broken on postgres adapter, we're just going
  //   // to override the knowledge state with our own kb service results
  //   const kbService = this.ensureService(KnowledgeService, 'Knowledge base service not found')
  //   const memService = this.ensureService(MemoriesService, 'Memories service not found')
  //   // Run both searches in parallel
  //   const [kbItems, memItems] = await Promise.all([
  //     kbService.search({
  //       q: message.content.text,
  //       limit: this.matchLimit,
  //       matchThreshold: this.matchThreshold
  //     }),
  //     memService.search({
  //       q: message.content.text,
  //       limit: this.matchLimit,
  //       type: 'fragments',
  //       matchThreshold: this.matchThreshold
  //     })
  //   ])

  //   // Set RAG knowledge from kbService
  //   state.ragKnowledgeData = kbItems
  //   state.ragKnowledge = formatKnowledge(kbItems).trim()

  //   // Set regular knowledge from memService
  //   const knowledgeItems: KnowledgeItem[] = memItems
  //     .map((item) => {
  //       if (isNull(item.id)) {
  //         return undefined
  //       }
  //       return {
  //         id: item.id,
  //         content: item.content
  //       }
  //     })
  //     .filter((item) => !isNull(item))
  //   state.knowledge = formatKnowledge(knowledgeItems).trim()
  //   state.knowledgeData = knowledgeItems

  //   return state
  // }
}
