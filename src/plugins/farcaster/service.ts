import { hasFarcasterEnabled, validateFarcasterConfig } from '@/plugins/farcaster/common/config'
import { FARCASTER_SERVICE_NAME } from '@/plugins/farcaster/common/constants'
import { FarcasterAgentManager } from '@/plugins/farcaster/managers/agent'
import { logger, Service, UUID, type IAgentRuntime } from '@elizaos/core'

export class FarcasterService extends Service {
  private managers = new Map<UUID, FarcasterAgentManager>()
  static serviceType: string = FARCASTER_SERVICE_NAME
  readonly capabilityDescription = 'The agent is able to send and receive messages on farcaster'

  // Called to start a single Farcaster service
  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = instance
    let manager = service.managers.get(runtime.agentId)

    if (manager) {
      console.warn('Farcaster service already started', runtime.agentId)
      return service
    }

    if (!hasFarcasterEnabled(runtime)) {
      logger.debug('Farcaster service not enabled', runtime.agentId)
      return service
    }

    const farcasterConfig = validateFarcasterConfig(runtime)
    manager = new FarcasterAgentManager(runtime, farcasterConfig)
    service.managers.set(runtime.agentId, manager)
    await manager.start()

    logger.success('Farcaster client started', runtime.agentId)
    return service
  }

  // Called to stop a single Farcaster service
  static async stop(runtime: IAgentRuntime): Promise<void> {
    const service = instance
    const manager = service.managers.get(runtime.agentId)
    if (manager) {
      await manager.stop()
      service.managers.delete(runtime.agentId)
      console.log('Farcaster client stopped', runtime.agentId)
    } else {
      logger.debug('Farcaster service not running', runtime.agentId)
    }
  }

  // Called to stop all Farcaster services
  async stop(): Promise<void> {
    logger.debug('Stopping ALL Farcaster services')
    for (const manager of Array.from(this.managers.values())) {
      const agentId = manager.runtime.agentId
      try {
        await FarcasterService.stop(manager.runtime)
      } catch (error) {
        console.error('Error stopping Farcaster service', agentId, error)
      }
    }
  }
}

const instance = new FarcasterService()
