import { isNull } from '@/common/functions'
import { IAyaRuntime } from '@/common/iruntime'
import { ServiceKind } from '@/common/types'
import { IMemoriesService } from '@/services/interfaces'
import { Memory, Service } from '@elizaos/core'

export class MemoriesService extends Service implements IMemoriesService {
  public readonly capabilityDescription: string = 'Allows the agent to search for memories'
  protected readonly runtime: IAyaRuntime

  private constructor(runtime: IAyaRuntime) {
    super(runtime)
    this.runtime = runtime
  }

  static get serviceType(): string {
    return ServiceKind.memories
  }

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

  static async start(_runtime: IAyaRuntime): Promise<Service> {
    console.log(`[aya] starting ${MemoriesService.serviceType} service`)
    if (isNull(instance)) {
      instance = new MemoriesService(_runtime)
    }
    return instance
  }

  static async stop(_runtime: IAyaRuntime): Promise<void> {
    if (isNull(instance)) {
      throw new Error('MemoriesService not initialized')
    }
    await instance.stop()
  }

  async stop(): Promise<void> {}
}

let instance: MemoriesService | undefined
