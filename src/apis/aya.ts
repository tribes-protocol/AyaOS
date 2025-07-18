import { AGENTCOIN_FUN_API_URL } from '@/common/env'
import { serializeIdentity } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import {
  Agent,
  AgentSchema,
  CliAuthRequestSchema,
  CliAuthResponseSchema,
  ErrorResponseSchema,
  Identity,
  Knowledge,
  KnowledgeSchema,
  User,
  UserSchema
} from '@/common/types'
import { z } from 'zod'

const MessageResponseSchema = z.object({
  message: z.string()
})

export class AgentcoinAPI {
  async loginMessageToSign(identity: Identity): Promise<string> {
    const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/users/login-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity })
    })
    const data = await response.json()
    const parsed = MessageResponseSchema.parse(data)
    return parsed.message
  }

  async login({
    identity,
    message,
    signature
  }: {
    identity: Identity
    message: string
    signature: string
  }): Promise<string> {
    const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/users/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        identity,
        message,
        signature
      })
    })

    if (response.status !== 200) {
      throw new Error('Failed to login')
    }

    const setCookie = response.headers.get('set-cookie')
    if (!setCookie) {
      throw new Error('No cookie received from login')
    }

    return setCookie
  }

  async getUser(identity: Identity): Promise<User | undefined> {
    const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/users/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: serializeIdentity(identity) })
    })

    if (response.status === 404) {
      return undefined
    }

    if (response.status !== 200) {
      const error = await response.json()
      const parsed = ErrorResponseSchema.parse(error)
      throw new Error(parsed.error)
    }

    const data = await response.json()
    const parsed = UserSchema.parse(data)
    return parsed
  }

  async provisionAgent(signupToken: string, signature: string, publicKey: string): Promise<Agent> {
    const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/agents/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ signupToken, signature, publicKey })
    })

    if (!response.ok) {
      throw new Error('Failed to provision agent coin')
    }

    const data = await response.json()
    const parsed = AgentSchema.parse(data)
    return parsed
  }

  async generateAuthMessage(publicKey: string): Promise<string> {
    const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/agents/gen-auth-msg`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ publicKey })
    })

    if (!response.ok) {
      throw new Error('Failed to generate auth message')
    }

    const data = MessageResponseSchema.parse(await response.json())
    return data.message
  }

  async getKnowledges(
    identity: Identity,
    options: { cookie: string; limit: number; cursor: number }
  ): Promise<Knowledge[]> {
    const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/agents/knowledge/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: options.cookie },
      body: JSON.stringify({ agentId: identity, limit: options.limit, cursor: options.cursor })
    })

    if (response.status !== 200) {
      throw new Error('Failed to get knowledges')
    }

    const responseData = await response.json()
    const knowledges = KnowledgeSchema.array().parse(responseData)
    return knowledges
  }

  async createAgent(
    message: string,
    publicKey: string,
    signature: string,
    cookie: string,
    name?: string | undefined,
    purpose?: string | undefined
  ): Promise<Agent> {
    const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/agents/create-pure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name,
        purpose,
        proof: { message, publicKey, signature }
      })
    })

    if (response.status !== 200) {
      const errorBody = await response.text()
      ayaLogger.error('Failed to create pure agent', errorBody)
      throw new Error(`Failed to create pure agent`)
    }

    const responseData = await response.json()
    return AgentSchema.parse(responseData)
  }

  async createCliAuthRequest(): Promise<string> {
    const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/cliauth/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    if (response.status !== 200) {
      throw new Error('Failed to create cli auth request')
    }

    const responseData = await response.json()
    const { id } = CliAuthResponseSchema.parse(responseData)

    return id
  }

  async getCliAuthRequest(id: string): Promise<string | undefined> {
    const response = await fetch(`${AGENTCOIN_FUN_API_URL}/api/cliauth/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    })

    if (response.status === 202) {
      return undefined
    }

    if (response.status !== 200) {
      throw new Error('Failed to get cli auth request')
    }

    const responseData = await response.json()
    const { token } = CliAuthRequestSchema.parse(responseData)

    return token
  }
}
