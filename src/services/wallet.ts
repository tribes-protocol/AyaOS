import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { isNull } from '@/common/functions'
import { IAyaRuntime } from '@/common/iruntime'
import {
  AgentWallet,
  AgentWalletKind,
  HexString,
  Identity,
  ServiceKind,
  Transaction
} from '@/common/types'
import { IWalletService } from '@/services/interfaces'
import { Service } from '@elizaos/core'
import { TurnkeyClient } from '@turnkey/http'
import { ApiKeyStamper } from '@turnkey/sdk-server'
import { createAccountWithAddress } from '@turnkey/viem'
import { Account, getAddress, WalletClient } from 'viem'
import { base } from 'viem/chains'

export class WalletService extends Service implements IWalletService {
  private readonly turnkey: TurnkeyClient

  readonly serviceType = ServiceKind.wallet
  readonly capabilityDescription = ''

  private constructor(
    private readonly agentcoinCookie: string,
    private readonly agentcoinIdentity: Identity,
    private readonly agentcoinAPI: AgentcoinAPI,
    readonly runtime: IAyaRuntime,
    apiKeyStamper: ApiKeyStamper
  ) {
    super(runtime)
    this.turnkey = new TurnkeyClient(
      {
        baseUrl: 'https://api.turnkey.com'
      },
      apiKeyStamper
    )
  }

  static getInstance(
    agentcoinCookie: string,
    agentcoinIdentity: Identity,
    agentcoinAPI: AgentcoinAPI,
    runtime: IAyaRuntime,
    apiKeyStamper: ApiKeyStamper
  ): IWalletService {
    if (isNull(instance)) {
      instance = new WalletService(
        agentcoinCookie,
        agentcoinIdentity,
        agentcoinAPI,
        runtime,
        apiKeyStamper
      )
    }
    return instance
  }

  static async start(_runtime: IAyaRuntime): Promise<Service> {
    if (isNull(instance)) {
      throw new Error('WalletService not initialized')
    }
    return instance
  }

  static async stop(_runtime: IAyaRuntime): Promise<unknown> {
    if (isNull(instance)) {
      throw new Error('WalletService not initialized')
    }
    await instance.stop()
    return instance
  }

  async stop(): Promise<void> {
    // nothing to do
  }

  async getDefaultWallet(kind: AgentWalletKind): Promise<AgentWallet> {
    const wallet = await this.agentcoinAPI.getDefaultWallet(this.agentcoinIdentity, kind, {
      cookie: this.agentcoinCookie
    })
    if (isNull(wallet)) {
      throw new Error('Failed to get default wallet')
    }
    return wallet
  }

  async signPersonalMessage(wallet: AgentWallet, message: string): Promise<string> {
    const account = this.getAccount(wallet)
    if (isNull(account.signMessage)) {
      throw new Error('Failed to sign message. missing signMessage function')
    }
    return account.signMessage({ message })
  }

  async signAndSubmitTransaction(params: {
    client: WalletClient
    transaction: Transaction
  }): Promise<HexString> {
    const { client, transaction } = params
    if (!isNull(transaction.chainId) && transaction.chainId !== base.id) {
      throw new Error(`Unsupported chainId: ${transaction.chainId}`)
    }

    if (isNull(client.account)) {
      throw new Error('Failed to get account')
    }

    const txHash = await client.sendTransaction({
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      account: client.account,
      chain: base,
      // FIXME: hish - tackle kzg
      kzg: undefined
    })

    return txHash
  }

  private getAccount(wallet: AgentWallet): Account {
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

let instance: WalletService | undefined
