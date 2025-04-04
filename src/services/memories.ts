import { isNull } from '@/common/functions'
import { IMemoriesService } from '@/services/interfaces'
import { IAgentRuntime, Memory, Service } from '@elizaos/core'

export class MemoriesService extends Service implements IMemoriesService {
  public readonly capabilityDescription: string = 'Allows the agent to search for memories'
  protected readonly runtime: IAgentRuntime

  private constructor(runtime: IAgentRuntime) {
    super(runtime)
    this.runtime = runtime
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
    if (isNull(instance)) {
      instance = new MemoriesService(_runtime)
    }
    return instance
  }

  static async stop(_runtime: IAgentRuntime): Promise<void> {
    if (isNull(instance)) {
      throw new Error('MemoriesService not initialized')
    }
    await instance.stop()
  }

  async stop(): Promise<void> {}
}

let instance: MemoriesService | undefined
