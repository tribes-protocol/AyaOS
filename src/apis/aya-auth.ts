import { AYA_JWT_COOKIE_NAME } from '@/common/constants'
import { AGENTCOIN_FUN_API_URL } from '@/common/env'
import { serializeIdentity, toJsonTree } from '@/common/functions'
import {
  AgentEventData,
  AgentWallet,
  AgentWalletKind,
  AgentWalletSchema,
  ChatStatusBody,
  CreateMessage,
  ErrorResponseSchema,
  HydratedMessage,
  HydratedMessageSchema,
  Identity
} from '@/common/types'
import { logger } from '@elizaos/core'

export class AyaAuthAPI {
  private readonly cookie_: string

  constructor(readonly token: string) {
    this.cookie_ = `${AYA_JWT_COOKIE_NAME}=${token}`
  }

  get cookie(): string {
    return this.cookie_
  }

  async sendMessage(message: CreateMessage): Promise<HydratedMessage> {
    const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: this.cookie },
      body: JSON.stringify(toJsonTree(message))
    })
    if (response.status !== 200) {
      throw new Error('Failed to send message')
    }

    const responseData = await response.json()
    const hydratedMessage = HydratedMessageSchema.parse(responseData)

    return hydratedMessage
  }

  async sendStatus(newMessage: ChatStatusBody): Promise<void> {
    const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/chat/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: this.cookie },
      body: JSON.stringify(toJsonTree(newMessage))
    })
    if (response.status !== 200) {
      const error = await response.json()
      const parsed = ErrorResponseSchema.parse(error)
      throw new Error(parsed.error)
    }
  }

  async publishEvent(event: AgentEventData): Promise<void> {
    const body = JSON.stringify(toJsonTree(event))
    try {
      const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/agents/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: this.cookie },
        body
      })

      if (response.status !== 200) {
        const error = await response.json()
        throw new Error(ErrorResponseSchema.parse(error).error)
      }
    } catch (error) {
      logger.error('Failed to publish event', body, error)
    }
  }

  async getDefaultWallet(
    identity: Identity,
    kind: AgentWalletKind
  ): Promise<AgentWallet | undefined> {
    const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/wallets/get-default`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: this.cookie },
      body: JSON.stringify({
        agentId: serializeIdentity(identity),
        kind
      })
    })
    if (response.status !== 200) {
      return undefined
    }

    const responseData = await response.json()
    const wallet = AgentWalletSchema.parse(responseData)

    return wallet
  }
}
