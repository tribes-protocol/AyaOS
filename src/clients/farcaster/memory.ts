import type { FarcasterClient } from '@/clients/farcaster/client'
import type { Cast } from '@/clients/farcaster/types'
import { castUuid } from '@/clients/farcaster/utils'
import { ayaLogger } from '@/common/logger'
import {
  getEmbeddingZeroVector,
  stringToUuid,
  type IAgentRuntime,
  type Memory,
  type UUID
} from '@elizaos/core'
import { toHex } from 'viem'

export function createCastMemory({
  roomId,
  senderId,
  runtime,
  cast
}: {
  roomId: UUID
  senderId: UUID
  runtime: IAgentRuntime
  cast: Cast
}): Memory {
  const inReplyTo = cast.inReplyTo
    ? castUuid({
        hash: toHex(cast.inReplyTo.hash),
        agentId: runtime.agentId
      })
    : undefined

  return {
    id: castUuid({
      hash: cast.hash,
      agentId: runtime.agentId
    }),
    agentId: runtime.agentId,
    userId: senderId,
    content: {
      text: cast.text,
      source: 'farcaster',
      url: '',
      inReplyTo,
      hash: cast.hash
    },
    roomId,
    embedding: getEmbeddingZeroVector()
  }
}

export async function buildConversationThread({
  cast,
  runtime,
  client
}: {
  cast: Cast
  runtime: IAgentRuntime
  client: FarcasterClient
}): Promise<Cast[]> {
  const thread: Cast[] = []
  const visited: Set<string> = new Set()
  async function processThread(currentCast: Cast): Promise<void> {
    if (visited.has(currentCast.hash)) {
      return
    }

    visited.add(currentCast.hash)

    const roomId = castUuid({
      hash: currentCast.hash,
      agentId: runtime.agentId
    })

    // Check if the current cast has already been saved
    const memory = await runtime.messageManager.getMemoryById(roomId)

    if (!memory) {
      ayaLogger.log('Creating memory for cast', currentCast.hash)

      const userId = stringToUuid(currentCast.authorFid.toString())

      await runtime.ensureConnection(
        userId,
        roomId,
        currentCast.profile.username,
        currentCast.profile.name,
        'farcaster'
      )

      await runtime.messageManager.createMemory(
        createCastMemory({
          roomId,
          senderId: userId,
          runtime,
          cast: currentCast
        })
      )
    }

    thread.unshift(currentCast)

    if (currentCast.inReplyTo) {
      const parentCast = await client.getCast(currentCast.inReplyTo.hash)
      if (parentCast) {
        await processThread(parentCast)
      }
    }
  }

  await processThread(cast)
  return thread
}
