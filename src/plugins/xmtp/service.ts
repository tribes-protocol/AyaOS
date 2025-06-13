import { AgentRegistry } from '@/agent/registry'
import { AYA_AGENT_DATA_DIR_KEY } from '@/common/constants'
import { ensureStringSetting, isNull, retry } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import { HexStringSchema } from '@/common/types'
import { XMTPManager } from '@/plugins/xmtp/client'
import { XMTP_KEY } from '@/plugins/xmtp/constants'
import { createSigner } from '@/plugins/xmtp/helper'
import { WalletService } from '@/services/wallet'
import { IAgentRuntime, Service, ServiceTypeName, UUID } from '@elizaos/core'
import { ReplyCodec } from '@xmtp/content-type-reply'
import { Client as XmtpClient, XmtpEnv } from '@xmtp/node-sdk'
import path from 'path'
import { Account, privateKeyToAccount } from 'viem/accounts'

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

    const walletService = runtime.getService<WalletService>(
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      WalletService.serviceType as ServiceTypeName
    )

    if (isNull(walletService)) {
      throw new Error('Wallet service not found')
    }

    const pvtKey = runtime.getSetting(XMTP_KEY)
    let account: Account

    if (isNull(pvtKey)) {
      const defaultWallet = await walletService.getDefaultWallet('evm')
      if (isNull(defaultWallet)) {
        throw new Error('Default wallet not found, cannot start XMTP service')
      }

      account = walletService.getAccount(defaultWallet)
    } else {
      const walletPrivateKey = HexStringSchema.parse(pvtKey)
      account = privateKeyToAccount(walletPrivateKey)
    }

    const signer = createSigner(account)
    const env: XmtpEnv = 'production'

    const dataDir = ensureStringSetting(runtime, AYA_AGENT_DATA_DIR_KEY)
    const { managers } = AgentRegistry.get(dataDir)
    const pathResolver = managers.path

    const config = {
      env,
      dbPath: path.join(pathResolver.xmtpDbDir, 'messages'),
      codecs: [new ReplyCodec()]
    }

    ayaLogger.info('XMTP initializing...', config)
    const client = await XmtpClient.create(signer, config)

    manager = new XMTPManager(runtime, client)
    service.managers.set(runtime.agentId, manager)
    void retry(async () => await manager.start(), { maxRetries: 3, logError: true, ms: 1000 })

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
