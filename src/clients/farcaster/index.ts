import { FarcasterClient } from '@/clients/farcaster/client'
import { type FarcasterConfig } from '@/clients/farcaster/environment'
import { FarcasterInteractionManager } from '@/clients/farcaster/interactions'
import { FarcasterPostManager } from '@/clients/farcaster/post'
import { Client, IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import { Configuration, NeynarAPIClient } from '@neynar/nodejs-sdk'

/**
 * A manager that orchestrates all Farcaster operations:
 * - client: base operations (Neynar client, hub connection, etc.)
 * - posts: autonomous posting logic
 * - interactions: handling mentions, replies, likes, etc.
 */
export class FarcasterManager implements Client {
  client: FarcasterClient
  posts: FarcasterPostManager
  interactions: FarcasterInteractionManager
  private signerUuid: string
  private runtime: IAyaRuntime
  constructor(runtime: IAyaRuntime, farcasterConfig: FarcasterConfig) {
    this.runtime = runtime
    const cache = new Map<string, unknown>()
    this.signerUuid = runtime.ensureSetting(
      'FARCASTER_NEYNAR_SIGNER_UUID',
      'FARCASTER_NEYNAR_SIGNER_UUID is not set'
    )

    const neynarConfig = new Configuration({
      apiKey: runtime.ensureSetting(
        'FARCASTER_NEYNAR_API_KEY',
        'FARCASTER_NEYNAR_API_KEY is not set'
      )
    })

    const neynarClient = new NeynarAPIClient(neynarConfig)

    this.client = new FarcasterClient({
      runtime,
      ssl: true,
      url: runtime.getSetting('FARCASTER_HUB_URL') ?? 'hub.pinata.cloud',
      neynar: neynarClient,
      signerUuid: this.signerUuid,
      cache,
      farcasterConfig
    })

    ayaLogger.success('Farcaster Neynar client initialized.')

    this.posts = new FarcasterPostManager(this.client, runtime, this.signerUuid, cache)

    this.interactions = new FarcasterInteractionManager(
      this.client,
      runtime,
      this.signerUuid,
      cache
    )

    ayaLogger.info('✅ Farcaster client initialized.')
  }

  async start(runtime: IAyaRuntime): Promise<void> {
    if (this.runtime.agentId !== runtime.agentId) {
      throw new Error('Farcaster client runtime mismatch')
    }

    await Promise.all([this.posts.start(), this.interactions.start()])
  }

  async stop(runtime: IAyaRuntime): Promise<void> {
    if (this.runtime.agentId !== runtime.agentId) {
      throw new Error('Farcaster client runtime mismatch')
    }

    await Promise.all([this.posts.stop(), this.interactions.stop()])
  }
}
