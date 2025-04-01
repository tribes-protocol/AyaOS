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

// FIXME: hish - implement validator
// const ResponseValidationSchema = z.object({
//   valid: z.boolean(),
//   correctedResponse: z.string(),
//   correctedAction: z.string().optional().nullable(),
//   explanation: z.string()
// })

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

      // FIXME: hish - make this configurable in the future
      opts.eliza.character.plugins.push('@elizaos/plugin-openai')

      // Ensure Twitter plugin is included
      // if (!opts.eliza.character.plugins.includes('@elizaos/plugin-twitter')) {
      //   opts.eliza.character.plugins.push('@elizaos/plugin-twitter')
      // }

      // // Ensure Discord plugin is included
      // if (!opts.eliza.character.plugins.includes('@elizaos/plugin-discord')) {
      //   opts.eliza.character.plugins.push('@elizaos/plugin-discord')
      // }

      // Ensure sql plugin is included
      if (!opts.eliza.character.plugins.includes('@elizaos/plugin-sql')) {
        opts.eliza.character.plugins.push('@elizaos/plugin-sql')
      }

      // FIXME: hish - need to add a plugin for the agentcoin and farcaster

      // if (!opts.eliza.character.plugins.includes('@elizaos/plugin-farcaster')) {
      //   opts.eliza.character.plugins.push('@elizaos/plugin-farcaster')
      // }
    }

    super({ ...opts.eliza })
    this.pathResolver = opts.pathResolver
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
}
