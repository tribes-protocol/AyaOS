import { AgentRegistry } from '@/agent/registry'
import { AyaAuthAPI } from '@/apis/aya-auth'
import {
  AYA_AGENT_DATA_DIR_KEY,
  AYA_AGENT_IDENTITY_KEY,
  AYA_JWT_SETTINGS_KEY
} from '@/common/constants'
import { ensureStringSetting, isNull } from '@/common/functions'
import { AgentIdentitySchema, AgentWallet, AgentWalletKind, Identity } from '@/common/types'
import { IWalletService } from '@/services/interfaces'
import { IAgentRuntime, Service, UUID } from '@elizaos/core'
import { TurnkeyClient } from '@turnkey/http'
import { createAccountWithAddress } from '@turnkey/viem'
import { Account, getAddress } from 'viem'

export class WalletService extends Service implements IWalletService {
  static readonly instances = new Map<UUID, WalletService>()
  private readonly turnkey: TurnkeyClient

  static readonly serviceType = 'aya-os-wallet-service'
  readonly capabilityDescription = ''
  private readonly authAPI: AyaAuthAPI
  private readonly identity: Identity

  constructor(readonly runtime: IAgentRuntime) {
    super(runtime)
    const token = ensureStringSetting(runtime, AYA_JWT_SETTINGS_KEY)
    const identity = ensureStringSetting(runtime, AYA_AGENT_IDENTITY_KEY)
    const dataDir = ensureStringSetting(runtime, AYA_AGENT_DATA_DIR_KEY)
    this.authAPI = new AyaAuthAPI(token)
    this.identity = AgentIdentitySchema.parse(identity)
    const { managers } = AgentRegistry.get(dataDir)

    this.turnkey = new TurnkeyClient(
      {
        baseUrl: 'https://api.turnkey.com'
      },
      managers.keychain.turnkeyApiKeyStamper
    )
  }

  static async start(_runtime: IAgentRuntime): Promise<Service> {
    let instance = WalletService.instances.get(_runtime.agentId)
    if (instance) {
      return instance
    }
    instance = new WalletService(_runtime)
    WalletService.instances.set(_runtime.agentId, instance)
    return instance
  }

  static async stop(_runtime: IAgentRuntime): Promise<unknown> {
    const instance = WalletService.instances.get(_runtime.agentId)
    if (isNull(instance)) {
      return undefined
    }
    await instance.stop()
    return instance
  }

  async stop(): Promise<void> {
    // nothing to do
  }

  async getDefaultWallet(kind: AgentWalletKind): Promise<AgentWallet | undefined> {
    const wallet = await this.authAPI.getDefaultWallet(this.identity, kind)

    return wallet
  }

  async signPersonalMessage(wallet: AgentWallet, message: string): Promise<string> {
    const account = this.getAccount(wallet)
    if (isNull(account.signMessage)) {
      throw new Error('Failed to sign message. missing signMessage function')
    }
    return account.signMessage({ message })
  }

  getAccount(wallet: AgentWallet): Account {
    const address = getAddress(wallet.address)
    const account = createAccountWithAddress({
      client: this.turnkey,
      organizationId: wallet.subOrganizationId,
      signWith: address,
      ethereumAddress: address
    })
    return account
  }
}
