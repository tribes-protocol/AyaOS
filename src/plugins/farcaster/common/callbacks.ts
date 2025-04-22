import { FarcasterClient } from '@/plugins/farcaster/client'
import { CastId, FarcasterConfig } from '@/plugins/farcaster/common/types'
import { createCastMemory, neynarCastToCast } from '@/plugins/farcaster/common/utils'
import { HandlerCallback, IAgentRuntime, logger, Memory, UUID } from '@elizaos/core'
import { CastWithInteractions } from '@neynar/nodejs-sdk/build/api'

export function standardCastHandlerCallback({
  client,
  runtime,
  config,
  roomId,
  onCompletion,
  onError,
  inReplyTo
}: {
  inReplyTo?: CastId
  client: FarcasterClient
  runtime: IAgentRuntime
  config: FarcasterConfig
  roomId: UUID
  onCompletion?: (casts: CastWithInteractions[], memories: Memory[]) => Promise<void>
  onError?: (error: unknown) => Promise<void>
}): HandlerCallback {
  const callback: HandlerCallback = async (content, _files) => {
    try {
      if (config.FARCASTER_DRY_RUN) {
        console.log(`[Farcaster] Dry run: would have cast: ${content.text}`)
        return []
      }

      const casts = await client.sendCast({ content, inReplyTo })

      if (casts.length === 0) {
        console.warn('[Farcaster] No casts posted')
        return []
      }

      const memories: Memory[] = []
      for (let i = 0; i < casts.length; i++) {
        const cast = casts[i]
        logger.success(`[Farcaster] Published cast ${cast.hash}`)

        const memory = createCastMemory({
          roomId,
          senderId: runtime.agentId,
          runtime,
          cast: neynarCastToCast(cast)
        })

        if (i === 0) {
          // sendCast removes the response action, so we need to add it back here
          memory.content.actions = content.actions
        }

        await runtime.createMemory(memory, 'messages')
        memories.push(memory)
      }

      if (onCompletion) {
        await onCompletion(casts, memories)
      }

      return memories
    } catch (error) {
      console.error('[Farcaster] Error posting cast:', error)

      if (onError) {
        await onError(error)
      }

      return []
    }
  }

  return callback
}
