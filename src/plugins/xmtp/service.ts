import { ayaLogger } from '@/common/logger'
import { HexStringSchema } from '@/common/types'
import { XMTPManager } from '@/plugins/xmtp/client'
import { XMTP_KEY } from '@/plugins/xmtp/constants'
import { createSigner } from '@/plugins/xmtp/helper'
import { IAgentRuntime, Service, UUID } from '@elizaos/core'
import { Client as XmtpClient, XmtpEnv } from '@xmtp/node-sdk'

export class XMTPService extends Service {
  static serviceType = 'xmtp'
  capabilityDescription = 'The agent is able to send and receive messages on xmtp'
  private managers = new Map<UUID, XMTPManager>()

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = instance
    let manager = service.managers.get(runtime.agentId)

    if (manager) {
      ayaLogger.warn('XMTP service already started', runtime.agentId)
      return service
    }

    const walletPrivateKey = HexStringSchema.parse(runtime.getSetting(XMTP_KEY))

    const signer = createSigner(walletPrivateKey)
    const env: XmtpEnv = 'dev'

    const client = await XmtpClient.create(signer, {
      env
    })

    manager = new XMTPManager(runtime, client)
    service.managers.set(runtime.agentId, manager)
    await manager.start()

    ayaLogger.info('XMTP client started', runtime.agentId)
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
        await XMTPService.stop(manager.runtime)
      } catch (error) {
        ayaLogger.error('Error stopping XMTP service', { agentId, error })
      }
    }
  }

  getManager(agentId: UUID): XMTPManager | undefined {
    return this.managers.get(agentId)
  }
}

const instance = new XMTPService()
