import { isNull } from '@/common/functions'
import { IMemoriesService } from '@/services/interfaces'
import { IAgentRuntime, Memory, Service, UUID } from '@elizaos/core'

export class MemoriesService extends Service implements IMemoriesService {
  static readonly instances = new Map<UUID, MemoriesService>()
  public readonly capabilityDescription: string = 'Allows the agent to search for memories'

  constructor(readonly runtime: IAgentRuntime) {
    super(runtime)
  }

  static readonly serviceType = 'aya-os-memories-service'

  async search(_options: {
    q: string
    limit: number
    type: string
    matchThreshold?: number
  }): Promise<Memory[]> {
    throw new Error('Not implemented')
    // const { q, limit, type, matchThreshold = this.runtime.matchThreshold } = options
    // const embedding = await embed(this.runtime, q)

    // return this.runtime.databaseAdapter.searchMemoriesByEmbedding(embedding, {
    //   match_threshold: matchThreshold,
    //   count: limit,
    //   tableName: type
    // })
  }

  static async start(_runtime: IAgentRuntime): Promise<Service> {
    console.log(`[aya] starting ${MemoriesService.serviceType} service`)
    let instance = MemoriesService.instances.get(_runtime.agentId)
    if (instance) {
      return instance
    }
    instance = new MemoriesService(_runtime)
    MemoriesService.instances.set(_runtime.agentId, instance)
    return instance
  }

  static async stop(_runtime: IAgentRuntime): Promise<unknown> {
    const instance = MemoriesService.instances.get(_runtime.agentId)
    if (isNull(instance)) {
      return undefined
    }
    await instance.stop()
    return instance
  }

  async stop(): Promise<void> {}
}
