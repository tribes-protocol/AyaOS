import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { USER_CREDENTIALS_FILE } from '@/common/constants'
import { AGENTCOIN_FUN_API_URL } from '@/common/env'
import { isNull, toJsonTree } from '@/common/functions'
import { IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import { PathResolver } from '@/common/path-resolver'
import {
  AgentIdentity,
  AgentIdentitySchema,
  AgentRegistrationSchema,
  CharacterSchema,
  ChatChannel,
  CreateMessage,
  CredentialsSchema,
  HydratedMessage,
  Identity,
  MessageStatusEnum,
  User
} from '@/common/types'
import { KeychainService } from '@/services/keychain'
import { Service } from '@elizaos/core'
import * as fs from 'fs'

export class AgentcoinService extends Service {
  private cachedCookie: string | undefined
  private cachedIdentity: Identity | undefined
  readonly serviceType = AgentcoinService.serviceType
  readonly capabilityDescription = ''

  private constructor(
    private readonly keychain: KeychainService,
    private readonly api: AgentcoinAPI,
    private readonly pathResolver: PathResolver
  ) {
    super(undefined)
  }

  static getInstance(
    keychain: KeychainService,
    api: AgentcoinAPI,
    pathResolver: PathResolver
  ): AgentcoinService {
    if (isNull(instance)) {
      instance = new AgentcoinService(keychain, api, pathResolver)
    }
    return instance
  }

  static async start(_runtime: IAyaRuntime): Promise<Service> {
    if (isNull(instance)) {
      throw new Error('AgentcoinService not initialized')
    }
    return instance
  }

  static async stop(_runtime: IAyaRuntime): Promise<unknown> {
    if (isNull(instance)) {
      throw new Error('AgentcoinService not initialized')
    }
    await instance.stop()
    return instance
  }

  async stop(): Promise<void> {
    // nothing to do
  }

  async getUser(identity: Identity): Promise<User | undefined> {
    return this.api.getUser(identity)
  }

  async getIdentity(): Promise<Identity> {
    if (isNull(this.cachedIdentity)) {
      const { id } = CharacterSchema.parse(
        JSON.parse(fs.readFileSync(this.pathResolver.characterFile, 'utf-8'))
      )
      this.cachedIdentity = AgentIdentitySchema.parse(`AGENT-${id}`)
    }
    return this.cachedIdentity
  }

  async sendStatus(channel: ChatChannel, status: MessageStatusEnum): Promise<void> {
    const cookie = await this.getCookie()

    await this.api.sendStatus(
      {
        channel,
        status
      },
      { cookie }
    )
  }

  async sendMessage(message: CreateMessage): Promise<HydratedMessage> {
    const cookie = await this.getCookie()

    return this.api.sendMessage(message, { cookie })
  }

  public async login(identity: Identity): Promise<string> {
    const message = await this.api.loginMessageToSign(identity)
    const signature = await this.keychain.sign(message)

    if (isNull(signature)) {
      throw new Error('Failed to sign message')
    }

    const token = await this.api.login({ identity, message, signature })

    ayaLogger.success('Agent coin logged in successfully', identity)
    return token
  }

  async provisionIfNeeded(name?: string | undefined, purpose?: string | undefined): Promise<void> {
    ayaLogger.info('Checking if agent coin is provisioned...')
    if (await this.isProvisioned()) {
      return
    }

    ayaLogger.info('Provisioning hardware...')

    const regPath = this.pathResolver.registrationFile

    if (!fs.existsSync(regPath)) {
      const agentId = await this.provisionPureAgent(name, purpose)
      ayaLogger.success('Agent coin provisioned successfully', agentId)
      return
    }

    const { registrationToken: token } = AgentRegistrationSchema.parse(
      JSON.parse(fs.readFileSync(regPath, 'utf-8'))
    )

    const signature = await this.keychain.sign(token)
    const publicKey = this.keychain.publicKey

    const character = await this.api.provisionAgent(token, signature, publicKey)
    fs.writeFileSync(
      this.pathResolver.characterFile,
      JSON.stringify(toJsonTree(character), null, 2)
    )

    ayaLogger.success('Agent coin provisioned successfully', character.id)

    fs.unlinkSync(regPath)
  }

  async getCookie(): Promise<string> {
    if (isNull(this.cachedCookie)) {
      const identity = await this.getIdentity()
      this.cachedCookie = await this.login(identity)
    }
    return this.cachedCookie
  }

  async getJwtAuthToken(): Promise<string> {
    const cookie = await this.getCookie()
    const match = cookie.match(/jwt_auth_token=([^;]+)/)
    if (isNull(match)) {
      throw new Error('Could not extract JWT token from cookie')
    }
    return match[1]
  }

  async provisionPureAgent(
    name?: string | undefined,
    purpose?: string | undefined
  ): Promise<AgentIdentity> {
    let token = await this.getCliAuthToken()
    if (isNull(token)) {
      token = await this.createCliAuthAndWaitForToken()
    }

    const message = this.keychain.publicKey
    const signature = await this.keychain.sign(message)

    const { agent, character } = await this.api.createAgent(
      message,
      this.keychain.publicKey,
      signature,
      `jwt_auth_token=${token}`,
      name,
      purpose
    )

    fs.writeFileSync(
      this.pathResolver.characterFile,
      JSON.stringify(toJsonTree(character), null, 2)
    )

    // Display agent creation success message
    const agentUrl = `${AGENTCOIN_FUN_API_URL}/agent/${agent.id}`
    const boxWidth = Math.max(70, agentUrl.length + 6) // Ensure minimum width of 70 chars

    console.log('\n┌' + '─'.repeat(boxWidth) + '┐')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + '  🎉 Congratulations! Your agent is created  '.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + '  Check it out here:'.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + `  ${agentUrl}`.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('└' + '─'.repeat(boxWidth) + '┘\n')

    return agent.id
  }

  async getCliAuthToken(): Promise<string | undefined> {
    if (!fs.existsSync(USER_CREDENTIALS_FILE)) {
      return undefined
    }
    const credentials = CredentialsSchema.parse(
      JSON.parse(fs.readFileSync(USER_CREDENTIALS_FILE, 'utf-8'))
    )
    return credentials.token
  }

  async createCliAuthAndWaitForToken(): Promise<string> {
    // Create the CLI auth request and get the ID
    const id = await this.api.createCliAuthRequest()

    // Calculate the box width based on the URL length
    const url = `${AGENTCOIN_FUN_API_URL}/user/connect?id=${id}`
    const boxWidth = Math.max(70, url.length + 6) // Ensure minimum width of 70 chars

    // Print a fancy bordered URL message for the user
    console.log('\n┌' + '─'.repeat(boxWidth) + '┐')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + '  🔐 Authentication Required  '.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + '  Please visit:'.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + `  ${url}`.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('│' + '  Waiting for authentication...'.padEnd(boxWidth, ' ') + '│')
    console.log('│' + ' '.repeat(boxWidth) + '│')
    console.log('└' + '─'.repeat(boxWidth) + '┘\n')

    // Poll for the response token
    let token: string | undefined
    let dots = 0
    const updateWaitingMessage = (): void => {
      process.stdout.write(`\r  Waiting${'.'.repeat(dots)}${' '.repeat(3 - dots)}`)
      dots = (dots + 1) % 4
    }

    const waitingInterval = setInterval(updateWaitingMessage, 500)

    try {
      while (isNull(token)) {
        await new Promise((resolve) => setTimeout(resolve, 1000))

        try {
          token = await this.api.getCliAuthRequest(id)
          if (token) {
            clearInterval(waitingInterval)
            console.log('\n\n┌' + '─'.repeat(boxWidth) + '┐')
            console.log('│' + ' '.repeat(boxWidth) + '│')
            console.log('│' + '  ✅ Authentication successful!'.padEnd(boxWidth - 1, ' ') + '│')
            console.log('│' + ' '.repeat(boxWidth) + '│')
            console.log('└' + '─'.repeat(boxWidth) + '┘\n')

            // Save the token to credentials.json
            fs.writeFileSync(
              USER_CREDENTIALS_FILE,
              JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2)
            )

            ayaLogger.success('Credentials saved to', USER_CREDENTIALS_FILE)
            return token
          }
        } catch (error) {
          clearInterval(waitingInterval)
          ayaLogger.error('Error polling for CLI auth token', error)
          throw new Error('Failed to authenticate via CLI')
        }
      }
    } catch (error) {
      clearInterval(waitingInterval)
      throw error
    }

    return token
  }

  private async isProvisioned(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.pathResolver.characterFile)) {
        return false
      }

      const character = CharacterSchema.parse(
        JSON.parse(fs.readFileSync(this.pathResolver.characterFile, 'utf-8'))
      )

      if (character.id) {
        return true
      }
      return false
    } catch (error) {
      console.log('Error parsing character file:', error)
      return false
    }
  }
}

let instance: AgentcoinService | undefined
