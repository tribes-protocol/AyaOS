import { ensure, isNull } from '@/common/functions'
// import { KnowledgeService } from '@/services/knowledge'
import { IAyaRuntime, ServiceLike } from '@/common/iruntime'
import { PathResolver } from '@/common/path-resolver'
import {
  AgentRuntime,
  Character,
  IDatabaseAdapter,
  Plugin,
  RuntimeSettings,
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
      character: Character
      plugins?: Plugin[]
      fetch?: typeof fetch
      adapter?: IDatabaseAdapter
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events?: { [key: string]: ((params: any) => void)[] }
      ignoreBootstrap?: boolean
      settings?: RuntimeSettings
    }
    pathResolver: PathResolver
  }) {
    if (isNull(opts.eliza.character.plugins)) {
      opts.eliza.character.plugins = []
    }

    // FIXME: hish - remove hack once my PR in elizaos is merged
    opts.eliza.character.secrets = opts.eliza.character.secrets || {}
    if (process.env.FARCASTER_FID) {
      opts.eliza.character.secrets.FARCASTER_FID = process.env.FARCASTER_FID
    }

    // require plugins
    const requiredPlugins = ['@elizaos/plugin-sql']
    for (const plugin of requiredPlugins) {
      if (!opts.eliza.character.plugins.includes(plugin)) {
        opts.eliza.character.plugins.push(plugin)
      }
    }

    // Ensure Twitter plugin is included
    // if (!opts.eliza.character.plugins.includes('@elizaos/plugin-twitter')) {
    //   opts.eliza.character.plugins.push('@elizaos/plugin-twitter')
    // }

    // // Ensure Discord plugin is included
    // if (!opts.eliza.character.plugins.includes('@elizaos/plugin-discord')) {
    //   opts.eliza.character.plugins.push('@elizaos/plugin-discord')
    // }

    // FIXME: hish - need to add a plugin for the agentcoin and farcaster

    // if (!opts.eliza.character.plugins.includes('@elizaos/plugin-farcaster')) {
    //   opts.eliza.character.plugins.push('@elizaos/plugin-farcaster')
    // }

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
