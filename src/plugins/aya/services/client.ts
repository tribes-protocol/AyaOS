import { AgentRegistry } from '@/agent/registry'
import { AyaAuthAPI } from '@/apis/aya-auth'
import {
  AYA_AGENT_DATA_DIR_KEY,
  AYA_AGENT_IDENTITY_KEY,
  AYA_JWT_SETTINGS_KEY,
  AYA_SOURCE
} from '@/common/constants'
import { AGENT_ADMIN_PUBLIC_KEY, AGENTCOIN_FUN_API_URL } from '@/common/env'
import {
  ensureStringSetting,
  isNull,
  isRequiredString,
  isValidSignature,
  serializeChannel,
  serializeIdentity
} from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import {
  AgentIdentitySchema,
  ChatChannel,
  ChatChannelKind,
  EthAddressSchema,
  HydratedMessageSchema,
  Identity,
  Message,
  MessageEventSchema,
  MessageStatusEnum,
  SentinelCommand,
  SentinelCommandSchema
} from '@/common/types'
import { updateEntity } from '@/helpers/updateEntity'
import {
  ChannelType,
  Content,
  EventType,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  Service,
  stringToUuid,
  UUID
} from '@elizaos/core'
import fs from 'fs'
import { io, Socket } from 'socket.io-client'

function messageIdToUuid(messageId: number): UUID {
  return stringToUuid('agentcoin:' + messageId.toString())
}

export class AyaClientService extends Service {
  static instances = new Map<UUID, AyaClientService>()

  private readonly authAPI: AyaAuthAPI
  private readonly identity: Identity // agent's identity
  private socket?: Socket
  static readonly serviceType = 'aya-os-client-service'
  readonly capabilityDescription = 'The agent is able to send and receive messages on AyaOS.ai'

  constructor(runtime: IAgentRuntime) {
    super(runtime)
    const token = ensureStringSetting(runtime, AYA_JWT_SETTINGS_KEY)
    const identity = ensureStringSetting(runtime, AYA_AGENT_IDENTITY_KEY)

    this.authAPI = new AyaAuthAPI(token)
    this.identity = AgentIdentitySchema.parse(identity)
  }

  async stop(): Promise<void> {
    if (isNull(this.socket)) {
      console.warn('AyaService not started', this.runtime.agentId)
      return
    }

    this.socket.disconnect()
    this.socket = undefined
  }

  private async start(): Promise<void> {
    if (this.socket) {
      console.warn(`Aya client already started for ${this.runtime.agentId}`)
      return
    }
    ayaLogger.info(`Starting Aya client for ${this.runtime.agentId}`)

    const socket = io(AGENTCOIN_FUN_API_URL, {
      reconnection: true,
      rejectUnauthorized: false,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      withCredentials: true,
      timeout: 20000,
      autoConnect: true,
      transports: ['websocket', 'polling'],
      extraHeaders: {
        Cookie: this.authAPI.cookie
      },
      auth: async (cb: (data: unknown) => void) => {
        try {
          cb({ jwtToken: this.authAPI.token })
        } catch (error) {
          console.error('Error getting JWT token', error)
          cb({})
        }
      }
    })

    this.socket = socket

    const eventName = `user:${serializeIdentity(this.identity)}`
    ayaLogger.info(
      `[aya] AyaOS (${process.env.npm_package_version}) client listening for event: ${eventName}`
    )

    // listen on DMs
    this.socket.on(eventName, async (data: unknown) => {
      try {
        const event = MessageEventSchema.parse(data)
        const channel = event.channel

        if (channel.kind !== ChatChannelKind.DM) {
          ayaLogger.info('Agentcoin client received msg for unknown channel', channel)
          return
        }

        // validate channel
        if (channel.firstIdentity !== this.identity && channel.secondIdentity !== this.identity) {
          ayaLogger.info('Agentcoin client received msg for unknown channel', channel)
          return
        }

        switch (event.kind) {
          case 'message': {
            // process message if allowed
            await this.processMessages(channel, event.data)
            break
          }
          case 'status':
            ayaLogger.info('Received status', event.data.status)
            break
        }
      } catch (error) {
        console.error('Error processing message from agentcoin client', error)
        console.error('Error processing message from agentcoin client', error)
      }
    })

    const AGENTCOIN_MONITORING_ENABLED = this.runtime.getSetting('AGENTCOIN_MONITORING_ENABLED')

    // listen on admin commands
    if (AGENTCOIN_MONITORING_ENABLED) {
      this.socket.on(`admin:${this.identity}`, async (payload: string) => {
        try {
          const jsonObj = JSON.parse(payload)
          const { content, signature } = jsonObj
          if (!isRequiredString(content) || !isRequiredString(signature)) {
            throw new Error('Invalid payload')
          }

          if (!isValidSignature(content, AGENT_ADMIN_PUBLIC_KEY, signature)) {
            throw new Error('Invalid signature')
          }

          const command = SentinelCommandSchema.parse(JSON.parse(content))
          await this.handleAdminCommand(command)
        } catch (e) {
          console.error('Error handling admin command:', e, payload)
        }
      })
    }

    this.socket.on('connect', () => {
      ayaLogger.info('Connected to Agentcoin API')
    })
    this.socket.on('disconnect', () => {
      ayaLogger.info('Disconnected from Agentcoin API')
    })
  }

  static async start(runtime: IAgentRuntime): Promise<Service> {
    ayaLogger.info(`Starting Aya Client Service for ${runtime.agentId}`)
    const cachedInstance = AyaClientService.instances.get(runtime.agentId)
    if (cachedInstance) {
      return cachedInstance
    }

    const instance = new AyaClientService(runtime)
    AyaClientService.instances.set(runtime.agentId, instance)
    await instance.start()
    return instance
  }

  static async stop(runtime: IAgentRuntime): Promise<unknown> {
    const instance = AyaClientService.instances.get(runtime.agentId)
    if (instance) {
      await instance.stop()
    }
    AyaClientService.instances.delete(runtime.agentId)
    return Promise.resolve()
  }

  private async handleAdminCommand(command: SentinelCommand): Promise<void> {
    ayaLogger.info('Handling admin command', command.kind)
    switch (command.kind) {
      case 'set_git':
        ayaLogger.info('Ignoring set_git. sentinel service is handling this', command)
        break
      case 'set_env_vars':
        ayaLogger.info('Setting env vars', command)
        await this.handleSetEnvvars(command.envVars)
        break
      default:
        throw new Error('Invalid command')
    }
  }

  private async handleSetEnvvars(envVars: Record<string, string>): Promise<void> {
    const dataDir = ensureStringSetting(this.runtime, AYA_AGENT_DATA_DIR_KEY)
    const { managers } = AgentRegistry.get(dataDir)
    const envContent = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')
    const pathResolver = managers.path
    await fs.promises.writeFile(pathResolver.envFile, envContent)

    await managers.config.checkEnvUpdate()
  }

  private async sendStatusOnInterval(
    channel: ChatChannel,
    status: MessageStatusEnum
  ): Promise<() => void> {
    await this.authAPI.sendStatus({ channel, status })
    const statusInterval = setInterval(async () => {
      await this.authAPI.sendStatus({ channel, status })
    }, 5000)
    return () => clearInterval(statusInterval)
  }

  private async processMessages(channel: ChatChannel, data: unknown): Promise<void> {
    const messages = HydratedMessageSchema.array().parse(data)

    const { message, user } = messages[0]

    if (isNull(message)) {
      ayaLogger.info('AgentcoinClient received empty message')
      return
    }

    if (message.sender === this.identity) {
      return
    }

    ayaLogger.info('Agentcoin client received event', data)

    const stopStatusInterval = await this.sendStatusOnInterval(channel, 'thinking')

    try {
      const channelId = serializeChannel(channel)
      const roomId = stringToUuid(channelId)
      const entityId = stringToUuid(serializeIdentity(message.sender))

      await updateEntity(this.runtime, entityId, {
        id: message.sender,
        username: user.username,
        name: user.username,
        imageUrl: user.image ?? undefined
      })

      await this.runtime.ensureConnection({
        entityId,
        roomId,
        userName: user.username,
        name: user.username,
        source: AYA_SOURCE,
        type: ChannelType.DM,
        channelId,
        worldId: roomId // matching telegram logic where DMs worldId is the roomId
      })

      await this.runtime.ensureRoomExists({
        id: roomId,
        name: user.username,
        source: AYA_SOURCE,
        type: ChannelType.DM,
        channelId,
        worldId: roomId // matching telegram logic where DMs worldId is the roomId
      })

      const memory: Memory = {
        id: messageIdToUuid(message.id),
        entityId,
        agentId: this.runtime.agentId,
        roomId,
        content: {
          text: message.text,
          source: AYA_SOURCE,
          ayaMessageId: message.id,
          walletAddress: EthAddressSchema.safeParse(user.identity).success
            ? user.identity
            : undefined
        },
        createdAt: message.createdAt.getTime(),
        unique: true
      }

      // Create callback for handling responses
      const callback: HandlerCallback = async (content: Content, _files?: string[]) => {
        stopStatusInterval()
        const response = await this.sendMessageAsAgent({
          identity: message.sender,
          content,
          channel
        })
        return isNull(response) ? [] : [response]
      }

      // Let the bootstrap plugin handle the message
      await this.runtime.emitEvent(EventType.MESSAGE_RECEIVED, {
        runtime: this.runtime,
        message: memory,
        callback,
        source: AYA_SOURCE
      })
    } catch (error) {
      console.error('Error processing message', error)
      stopStatusInterval()
      await this.sendMessageAsAgent({
        identity: message.sender,
        content: { text: 'Error processing message due to unknown error' },
        channel
      })
    } finally {
      stopStatusInterval()
    }
  }

  private async sendMessageAsAgent({
    identity,
    content,
    channel
  }: {
    identity: Identity
    content: Content
    channel: ChatChannel
  }): Promise<Memory | undefined> {
    const { text, actions, inReplyTo, attachments } = content

    // TODO: hish - need to update code to handle multiple attachments
    const firstAttachment = attachments?.[0]
    const imageUrl = firstAttachment?.url
    const messageText = imageUrl ? text + ` ${imageUrl}` : text

    if (isNull(messageText) || messageText.trim().length === 0) {
      ayaLogger.info('AgentcoinClient received message with no text. skipping')
      return undefined
    }

    const agentcoinResponse = await this.authAPI.sendMessage({
      text: messageText,
      sender: identity,
      channel,
      clientUuid: crypto.randomUUID(),
      openGraphId: null
    })

    return this.saveMessage({
      message: agentcoinResponse.message,
      actions,
      inReplyTo
    })
  }

  private async saveMessage({
    message,
    actions,
    inReplyTo
  }: {
    message: Message
    actions?: string[]
    inReplyTo?: UUID
  }): Promise<Memory> {
    const roomId = stringToUuid(serializeChannel(message.channel))
    const messageId = messageIdToUuid(message.id)
    const entityId = AgentIdentitySchema.safeParse(message.sender).success
      ? this.runtime.agentId
      : stringToUuid(serializeIdentity(message.sender))

    const responseMessage: Memory = {
      id: messageId,
      agentId: this.runtime.agentId,
      entityId,
      roomId,
      content: {
        text: message.text,
        source: AYA_SOURCE,
        inReplyTo,
        ayaMessageId: message.id,
        actions
      },
      createdAt: message.createdAt.getTime(),
      unique: true
    }

    await this.runtime.addEmbeddingToMemory(responseMessage)
    await this.runtime.createMemory(responseMessage, 'messages', true)

    return responseMessage
  }
}
