import { AYA_SOURCE } from '@/common/constants'
import {
  AGENT_ADMIN_PUBLIC_KEY,
  AGENTCOIN_FUN_API_URL,
  AGENTCOIN_MONITORING_ENABLED
} from '@/common/env'
import {
  isNull,
  isRequiredString,
  isValidSignature,
  serializeChannel,
  serializeIdentity
} from '@/common/functions'
import { IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import {
  AgentIdentitySchema,
  ChatChannel,
  ChatChannelKind,
  HydratedMessageSchema,
  Identity,
  Message,
  MessageEventSchema,
  MessageStatusEnum,
  SentinelCommand,
  SentinelCommandSchema
} from '@/common/types'
import { AgentcoinService } from '@/services/agentcoinfun'
import { ConfigService } from '@/services/config'
import {
  ChannelType,
  Character,
  Content,
  EventType,
  HandlerCallback,
  logger,
  Memory,
  Service,
  stringToUuid,
  UUID
} from '@elizaos/core'
import * as fs from 'fs'
import { io, Socket } from 'socket.io-client'

function messageIdToUuid(messageId: number): UUID {
  return stringToUuid('agentcoin:' + messageId.toString())
}

export class AyaService extends Service {
  private socket?: Socket

  readonly capabilityDescription = 'The agent is able to send and receive messages on aya'

  constructor(readonly runtime: IAyaRuntime) {
    super(runtime)
  }

  static get serviceType(): string {
    return 'aya'
  }

  static async start(runtime: IAyaRuntime): Promise<Service> {
    const agentcoinService = runtime.ensureService<AgentcoinService>(
      AgentcoinService.serviceType,
      'Agentcoin service not found'
    )

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
        Cookie: await agentcoinService.getCookie()
      },
      auth: async (cb: (data: unknown) => void) => {
        try {
          const jwtToken = await agentcoinService.getJwtAuthToken()
          cb({ jwtToken })
        } catch (error) {
          logger.error('Error getting JWT token', error)
          cb({})
        }
      }
    })

    const instance = new AyaService(runtime)
    instance.socket = socket

    const identity = await agentcoinService.getIdentity()
    const eventName = `user:${serializeIdentity(identity)}`
    ayaLogger.info(
      `AyaOS (${process.env.npm_package_version}) client listening for event`,
      eventName
    )

    // listen on DMs
    instance.socket.on(eventName, async (data: unknown) => {
      // ayaLogger.info('Agentcoin client received event', data)
      try {
        const event = MessageEventSchema.parse(data)
        const channel = event.channel

        if (channel.kind !== ChatChannelKind.DM) {
          ayaLogger.info('Agentcoin client received msg for unknown channel', channel)
          return
        }

        // validate channel
        if (channel.firstIdentity !== identity && channel.secondIdentity !== identity) {
          ayaLogger.info('Agentcoin client received msg for unknown channel', channel)
          return
        }

        switch (event.kind) {
          case 'message': {
            // process message if allowed
            await instance.processMessage(channel, event.data)
            break
          }
          case 'status':
            ayaLogger.info('Received status', event.data.status)
            break
        }
      } catch (error) {
        console.error('Error processing message from agentcoin client', error)
        ayaLogger.error('Error processing message from agentcoin client', error)
      }
    })

    // listen on admin commands
    if (AGENTCOIN_MONITORING_ENABLED) {
      instance.socket.on(`admin:${identity}`, async (payload: string) => {
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
          await instance.handleAdminCommand(command)
        } catch (e) {
          console.error('Error handling admin command:', e, payload)
        }
      })
    }
    return instance
  }

  // static stop(_runtime: IAyaRuntime): Promise<unknown> {
  //   return Promise.resolve()
  // }

  public async stop(): Promise<void> {
    this.socket?.disconnect()
    this.socket = undefined
  }

  private async handleAdminCommand(command: SentinelCommand): Promise<void> {
    ayaLogger.info('Handling admin command', command.kind)
    switch (command.kind) {
      case 'set_git':
        ayaLogger.info('ignoring set_git. sentinel service is handling this', command)
        break
      case 'set_character':
        await this.handleSetCharacter(command.character)
        break
      case 'set_knowledge':
        ayaLogger.info('ignoring set_knowledge', command)
        break
      case 'delete_knowledge':
        ayaLogger.info('ignoring delete_knowledge', command)
        break
      default:
        throw new Error('Invalid command')
    }
  }

  private async handleSetCharacter(character: Character): Promise<void> {
    const configService = this.runtime.ensureService<ConfigService>(
      ConfigService.serviceType,
      'Config service not found'
    )
    // write the character to the character file
    await fs.promises.writeFile(
      this.runtime.pathResolver.characterFile,
      JSON.stringify(character, null, 2)
    )

    // notify config service
    await configService.checkCharacterUpdate()
  }

  private async sendStatus(channel: ChatChannel, status: MessageStatusEnum): Promise<() => void> {
    const agentcoinService = this.runtime.ensureService<AgentcoinService>(
      AgentcoinService.serviceType,
      'Agentcoin service not found'
    )
    await agentcoinService.sendStatus(channel, status)
    const statusInterval = setInterval(async () => {
      await agentcoinService.sendStatus(channel, status)
    }, 5000)
    return () => clearInterval(statusInterval)
  }

  private async processMessage(channel: ChatChannel, data: unknown): Promise<void> {
    const agentcoinService = this.runtime.ensureService<AgentcoinService>(
      AgentcoinService.serviceType,
      'Agentcoin service not found'
    )
    const identity = await agentcoinService.getIdentity()
    const messages = HydratedMessageSchema.array().parse(data)

    const { message, user } = messages[0]

    if (isNull(message)) {
      ayaLogger.info('AgentcoinClient received empty message')
      return
    }

    if (message.sender === identity) {
      return
    }

    const unsubscribeThinking = await this.sendStatus(channel, 'thinking')

    const channelId = serializeChannel(channel)
    const roomId = stringToUuid(channelId)
    const entityId = stringToUuid(serializeIdentity(message.sender))

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
        ayaMessageId: message.id
      },
      createdAt: message.createdAt.getTime(),
      unique: true
    }

    // Create callback for handling responses
    const callback: HandlerCallback = async (content: Content, _files?: string[]) => {
      unsubscribeThinking()
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
    const agentcoinService = this.runtime.ensureService<AgentcoinService>(
      AgentcoinService.serviceType,
      'Agentcoin service not found'
    )

    const { text, actions, inReplyTo, attachments } = content

    // FIXME: hish - need to update code to handle multiple attachments
    const firstAttachment = attachments?.[0]
    const imageUrl = firstAttachment?.url
    const messageText = imageUrl ? text + ` ${imageUrl}` : text

    if (isNull(messageText) || messageText.trim().length === 0) {
      ayaLogger.info('AgentcoinClient received message with no text. skipping')
      return undefined
    }

    const agentcoinResponse = await agentcoinService.sendMessage({
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
