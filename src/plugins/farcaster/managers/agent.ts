import { FarcasterClient } from '@/plugins/farcaster/client'
import { type FarcasterConfig } from '@/plugins/farcaster/common/types'
import { FarcasterInteractionManager } from '@/plugins/farcaster/managers/interactions'
import { FarcasterPostManager } from '@/plugins/farcaster/managers/post'
import { logger, type IAgentRuntime } from '@elizaos/core'
import { Configuration, NeynarAPIClient } from '@neynar/nodejs-sdk'

/**
 * A manager that orchestrates all Farcaster operations:
 * - client: base operations (Neynar client, hub connection, etc.)
 * - posts: autonomous posting logic
 * - interactions: handling mentions, replies, likes, etc.
 */
export class FarcasterAgentManager {
  readonly runtime: IAgentRuntime
  readonly client: FarcasterClient
  readonly posts: FarcasterPostManager
  readonly interactions: FarcasterInteractionManager

  constructor(runtime: IAgentRuntime, config: FarcasterConfig) {
    this.runtime = runtime
    const signerUuid = config.FARCASTER_NEYNAR_SIGNER_UUID

    const neynarConfig = new Configuration({ apiKey: config.FARCASTER_NEYNAR_API_KEY })

    const neynar = new NeynarAPIClient(neynarConfig)

    const client = new FarcasterClient({ neynar, signerUuid })

    this.client = client

    logger.success('Farcaster Neynar client initialized.')

    this.posts = new FarcasterPostManager({ client, runtime, config })

    this.interactions = new FarcasterInteractionManager({ client, runtime, config })
  }

  async start(): Promise<void> {
    await Promise.all([this.posts.start(), this.interactions.start()])
  }

  async stop(): Promise<void> {
    await Promise.all([this.posts.stop(), this.interactions.stop()])
  }
}
