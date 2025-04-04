import { ClientBase } from '@/clients/twitter/base'
import { validateTwitterConfig, type TwitterConfig } from '@/clients/twitter/environment'
import { TwitterInteractionClient } from '@/clients/twitter/interactions'
import { TwitterPostClient } from '@/clients/twitter/post'
import { TwitterSearchClient } from '@/clients/twitter/search'
import { Client, IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'

/**
 * A manager that orchestrates all specialized Twitter logic:
 * - client: base operations (login, timeline caching, etc.)
 * - post: autonomous posting logic
 * - search: searching tweets / replying logic
 * - interaction: handling mentions, replies
 * - space: launching and managing Twitter Spaces (optional)
 */
export class TwitterManager implements Client {
  client: ClientBase
  post: TwitterPostClient
  search: TwitterSearchClient | undefined
  interaction: TwitterInteractionClient
  runtime: IAyaRuntime

  constructor(runtime: IAyaRuntime, twitterConfig: TwitterConfig) {
    this.runtime = runtime
    // Pass twitterConfig to the base client
    this.client = new ClientBase(runtime, twitterConfig)

    // Posting logic
    this.post = new TwitterPostClient(this.client, runtime)

    // Optional search logic (enabled if TWITTER_SEARCH_ENABLE is true)
    if (twitterConfig.TWITTER_SEARCH_ENABLE) {
      ayaLogger.warn('Twitter/X client running in a mode that:')
      ayaLogger.warn('1. violates consent of random users')
      ayaLogger.warn('2. burns your rate limit')
      ayaLogger.warn('3. can get your account banned')
      ayaLogger.warn('use at your own risk')
      this.search = new TwitterSearchClient(this.client, runtime)
    }

    // Mentions and interactions
    this.interaction = new TwitterInteractionClient(this.client, runtime)

    ayaLogger.info('🐦 Twitter client initialized')
  }

  async start(runtime: IAyaRuntime): Promise<TwitterManager> {
    if (this.runtime.agentId !== runtime.agentId) {
      throw new Error('Twitter client runtime mismatch')
    }

    ayaLogger.info('Twitter client started')

    // Initialize login/session
    await this.client.init()

    // Start the posting loop
    await this.post.start()

    // Start the search logic if it exists
    if (this.search) {
      await this.search.start()
    }

    // Start interactions (mentions, replies)
    await this.interaction.start()

    return this
  }

  async stop(runtime: IAyaRuntime): Promise<void> {
    if (this.runtime.agentId !== runtime.agentId) {
      throw new Error('Twitter client runtime mismatch')
    }

    ayaLogger.warn('Twitter client does not support stopping yet')
  }
}

export const TwitterClientInterface: Client = {
  async start(runtime: IAyaRuntime) {
    const twitterConfig: TwitterConfig = await validateTwitterConfig(runtime)

    ayaLogger.info('Twitter client started')

    const manager = new TwitterManager(runtime, twitterConfig)

    // Initialize login/session
    await manager.client.init()

    // Start the posting loop
    await manager.post.start()

    // Start the search logic if it exists
    if (manager.search) {
      await manager.search.start()
    }

    // Start interactions (mentions, replies)
    await manager.interaction.start()

    return manager
  },

  async stop(_runtime: IAyaRuntime) {
    ayaLogger.warn('Twitter client does not support stopping yet')
  }
}

export default TwitterClientInterface
