import { AyaRuntime } from '@/common/runtime'
import { ServiceKind } from '@/common/types'
import { IMemoriesService } from '@/services/interfaces'
import { embed, IAgentRuntime, Memory, Service, ServiceType } from '@elizaos/core'

export class MemoriesService extends Service implements IMemoriesService {
  constructor(private readonly runtime: AyaRuntime) {
    super()
  }

  static get serviceType(): ServiceType {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ServiceKind.memories as unknown as ServiceType
  }

  async initialize(_: IAgentRuntime): Promise<void> {}

  async search(options: {
    q: string
    limit: number
    type?: string
    matchThreshold?: number
  }): Promise<Memory[]> {
    const { q, limit, type, matchThreshold = 0.5 } = options
    const embedding = await embed(this.runtime, q)

    return this.runtime.databaseAdapter.searchMemoriesByEmbedding(embedding, {
      match_threshold: matchThreshold,
      count: limit,
      tableName: type ?? 'fragments'
    })
  }
}
