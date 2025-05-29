import { isNull } from '@/common/functions'
import { TwitterManager } from '@/plugins/twitter/client'
import { X_ACCESS_TOKEN, X_REFRESH_TOKEN } from '@/plugins/twitter/constants'
import { elizaLogger, IAgentRuntime, Service, UUID } from '@elizaos/core'
import { TwitterApi } from 'twitter-api-v2'

export class TwitterService extends Service {
  static serviceType = 'twitter'
  capabilityDescription = 'The agent is able to post tweets on Twitter/X'
  private managers = new Map<UUID, TwitterManager>()

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = instance
    let manager = service.managers.get(runtime.agentId)

    if (manager) {
      elizaLogger.warn('Twitter service already started', runtime.agentId)
      return service
    }

    const accessToken = runtime.getSetting(X_ACCESS_TOKEN)
    const refreshToken = runtime.getSetting(X_REFRESH_TOKEN)
    if (isNull(accessToken) || isNull(refreshToken)) {
      throw new Error('Missing required Twitter access token or refresh token')
    }

    // Create Twitter client
    const client = new TwitterApi(accessToken)

    manager = new TwitterManager(runtime, client, refreshToken)
    service.managers.set(runtime.agentId, manager)
    await manager.start()

    elizaLogger.info('Twitter service started', runtime.agentId)
    return service
  }

  static async stop(runtime: IAgentRuntime): Promise<void> {
    const service = instance
    const manager = service.managers.get(runtime.agentId)
    if (manager) {
      await manager.stop()
      service.managers.delete(runtime.agentId)
    }
  }

  async stop(): Promise<void> {
    for (const manager of Array.from(this.managers.values())) {
      const agentId = manager.runtime.agentId
      try {
        await TwitterService.stop(manager.runtime)
      } catch (error) {
        console.error('Error stopping Twitter service', agentId, error)
      }
    }
  }

  getManager(agentId: UUID): TwitterManager | undefined {
    return this.managers.get(agentId)
  }
}

const instance = new TwitterService()
