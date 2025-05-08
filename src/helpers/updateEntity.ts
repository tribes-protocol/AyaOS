import { isNull } from '@/common/functions'
import { IAgentRuntime, UUID } from '@elizaos/core'

export async function updateEntity(
  runtime: IAgentRuntime,
  entityId: UUID,
  source: {
    id: string
    username: string
    name?: string
    imageUrl?: string
    source: string
  }
): Promise<void> {
  const existingEntity = await runtime.getEntityById(entityId)
  if (isNull(existingEntity)) {
    await runtime.createEntity({
      id: entityId,
      agentId: runtime.agentId,
      names: [source.username],
      metadata: {
        [source.source]: {
          id: source.id,
          username: source.username,
          name: source.username,
          imageUrl: source.imageUrl
        }
      }
    })
  } else {
    await runtime.updateEntity({
      id: entityId,
      agentId: runtime.agentId,
      names: [source.username],
      metadata: {
        [source.source]: {
          id: source.id,
          username: source.username,
          name: source.username,
          imageUrl: source.imageUrl
        }
      }
    })
  }
}
