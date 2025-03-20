import { drizzleDB } from '@/common/db'
import { ensureUUID } from '@/common/functions'
import { AyaRuntime } from '@/common/runtime'
import { Memories } from '@/common/schema'
import { ServiceKind } from '@/common/types'
import { IMemoriesService } from '@/services/interfaces'
import { embed, IAgentRuntime, Memory, Service, ServiceType } from '@elizaos/core'
import { and, cosineDistance, desc, eq, gt, sql, SQL } from 'drizzle-orm'

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

    const similarity = sql<number>`1 - (${cosineDistance(Memories.embedding, embedding)})`

    // Start with base query and initial condition
    let conditions: SQL<unknown> = gt(similarity, matchThreshold)

    // Add type filter if provided
    if (type) {
      const typeCondition = and(conditions, eq(Memories.type, type))
      if (typeCondition) conditions = typeCondition
    }

    // Add agentId filter
    const agentCondition = and(conditions, eq(Memories.agentId, this.runtime.agentId))
    if (agentCondition) conditions = agentCondition

    const query = drizzleDB
      .select({
        memory: Memories,
        similarity
      })
      .from(Memories)
      .where(conditions)
      .orderBy((t) => desc(t.similarity))
      .limit(limit)

    const results = await query

    // Convert the database results to Memory format
    const entries = results.map((result) => {
      const mem = result.memory

      const memory: Memory = {
        id: ensureUUID(mem.id),
        agentId: ensureUUID(mem.agentId),
        userId: ensureUUID(mem.userId),
        roomId: ensureUUID(mem.roomId),
        content: {
          text: mem.content.text || '',
          ...(mem.content.inReplyTo ? { inReplyTo: ensureUUID(mem.content.inReplyTo) } : {}),
          ...Object.fromEntries(Object.entries(mem.content).filter(([key]) => key !== 'inReplyTo'))
        },
        createdAt: mem.createdAt?.getTime(),
        unique: mem.unique,
        similarity: result.similarity,
        ...(mem.embedding ? { embedding: Array.from(new Float32Array(mem.embedding)) } : {})
      }
      return memory
    })

    return entries
  }
}
