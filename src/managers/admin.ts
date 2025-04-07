import { AgentcoinAPI } from '@/apis/aya'
import { createGenericCharacter } from '@/common/character'
import { AYA_JWT_COOKIE_NAME, CHARACTERS_DIR, USER_CREDENTIALS_FILE } from '@/common/constants'
import { AGENTCOIN_FUN_API_URL } from '@/common/env'
import { ensureUUID, isNull, toJsonTree } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import {
  Agent,
  AgentIdentity,
  AgentIdentitySchema,
  AgentRegistrationSchema,
  AuthInfo,
  CredentialsSchema,
  Identity,
  ProvisionSchema,
  User
} from '@/common/types'
import { KeychainManager } from '@/managers/keychain'
import { PathManager } from '@/managers/path'
import * as fs from 'fs'
import path from 'path'

export class LoginManager {
  private readonly api = new AgentcoinAPI()
  constructor(
    private readonly keychain: KeychainManager,
    private readonly pathResolver: PathManager
  ) {}

  async getUser(identity: Identity): Promise<User | undefined> {
    return this.api.getUser(identity)
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

  async provisionIfNeeded(
    name?: string | undefined,
    purpose?: string | undefined
  ): Promise<AuthInfo> {
    ayaLogger.info('Checking if agent coin is provisioned...')
    if (await this.isProvisioned()) {
      return this.getAuthInfo()
    }

    ayaLogger.info('Provisioning agent...')

    const regPath = this.pathResolver.registrationFile

    if (!fs.existsSync(regPath)) {
      const agentId = await this.provisionPureAgent(name, purpose)
      ayaLogger.success('Agent coin provisioned successfully', agentId)
      return this.getAuthInfo()
    }

    const { registrationToken: token } = AgentRegistrationSchema.parse(
      JSON.parse(fs.readFileSync(regPath, 'utf-8'))
    )

    const signature = await this.keychain.sign(token)
    const publicKey = this.keychain.publicKey

    const agent = await this.api.provisionAgent(token, signature, publicKey)

    await this.provisionCharacter(agent)

    fs.unlinkSync(regPath)

    return this.getAuthInfo()
  }

  private async getAuthInfo(): Promise<{ identity: Identity; token: string; cookie: string }> {
    const identity = await this.getIdentity()
    const cookie = await this.login(identity)
    const match = cookie.match(`${AYA_JWT_COOKIE_NAME}=([^;]+)`)
    if (isNull(match)) {
      throw new Error('Could not extract JWT token from cookie')
    }
    const token = match[1]

    return { identity, token, cookie }
  }

  private async provisionPureAgent(
    name?: string | undefined,
    purpose?: string | undefined
  ): Promise<AgentIdentity> {
    let token = await this.getCliAuthToken()
    if (isNull(token)) {
      token = await this.createCliAuthAndWaitForToken()
    }

    const message = this.keychain.publicKey
    const signature = await this.keychain.sign(message)

    const agent = await this.api.createAgent(
      message,
      this.keychain.publicKey,
      signature,
      `jwt_auth_token=${token}`,
      name,
      purpose
    )

    await this.provisionCharacter(agent)

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

  private async getCliAuthToken(): Promise<string | undefined> {
    if (!fs.existsSync(USER_CREDENTIALS_FILE)) {
      return undefined
    }
    const credentials = CredentialsSchema.parse(
      JSON.parse(fs.readFileSync(USER_CREDENTIALS_FILE, 'utf-8'))
    )
    return credentials.token
  }

  private async createCliAuthAndWaitForToken(): Promise<string> {
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

  private async getIdentity(): Promise<Identity> {
    const { id } = ProvisionSchema.parse(
      JSON.parse(fs.readFileSync(this.pathResolver.provisionFile, 'utf-8'))
    )
    return AgentIdentitySchema.parse(`AGENT-${id}`)
  }

  private async isProvisioned(): Promise<boolean> {
    try {
      await this.getIdentity()
      return true
    } catch (error) {
      ayaLogger.error('Error parsing provision file:', error)
      return false
    }
  }

  private async provisionCharacter(agent: Agent): Promise<void> {
    const characterId = ensureUUID(agent.id.substring(6))

    const character = createGenericCharacter(agent.name, characterId)

    fs.writeFileSync(
      path.join(CHARACTERS_DIR, `${characterId}.character.json`),
      JSON.stringify(toJsonTree(character), null, 2)
    )

    fs.writeFileSync(
      this.pathResolver.provisionFile,
      JSON.stringify(toJsonTree({ id: agent.id }), null, 2)
    )

    ayaLogger.success('Agent coin provisioned successfully', characterId)
  }
}
