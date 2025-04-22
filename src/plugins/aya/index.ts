import { isNull } from '@/common/functions'
import { capabilitiesAction } from '@/plugins/aya/actions/capabilities'
import { ignoreAction } from '@/plugins/aya/actions/ignore'
import { replyAction } from '@/plugins/aya/actions/reply'
import { webSearch } from '@/plugins/aya/actions/websearch'
import {
  messageReceivedHandler,
  postGeneratedHandler,
  reactionReceivedHandler
} from '@/plugins/aya/events'
import { actionsProvider } from '@/plugins/aya/providers/actions'
import { characterProvider } from '@/plugins/aya/providers/character'
import { entitiesProvider } from '@/plugins/aya/providers/entities'
import { recentMessagesProvider } from '@/plugins/aya/providers/messages'
import { providersProvider } from '@/plugins/aya/providers/providers'
import { timeProvider } from '@/plugins/aya/providers/time'
import { AyaClientService } from '@/plugins/aya/services/client'
import { WebSearchService } from '@/plugins/aya/services/websearch'
import {
  ActionEventPayload,
  EntityPayload,
  EvaluatorEventPayload,
  EventType,
  InvokePayload,
  logger,
  MessagePayload,
  Plugin,
  WorldPayload
} from '@elizaos/core'

const events = {
  [EventType.MESSAGE_RECEIVED]: [
    async (payload: MessagePayload) => {
      if (isNull(payload.callback)) {
        throw Error('Callback is required')
      }

      await messageReceivedHandler({
        runtime: payload.runtime,
        message: payload.message,
        callback: payload.callback,
        onComplete: payload.onComplete
      })
    }
  ],

  [EventType.VOICE_MESSAGE_RECEIVED]: [
    async (payload: MessagePayload) => {
      if (isNull(payload.callback)) {
        throw Error('Callback is required')
      }

      await messageReceivedHandler({
        runtime: payload.runtime,
        message: payload.message,
        callback: payload.callback
      })
    }
  ],

  [EventType.REACTION_RECEIVED]: [
    async (payload: MessagePayload) => {
      await reactionReceivedHandler({
        runtime: payload.runtime,
        message: payload.message
      })
    }
  ],

  [EventType.POST_GENERATED]: [
    async (payload: InvokePayload) => {
      await postGeneratedHandler(payload)
    }
  ],

  [EventType.MESSAGE_SENT]: [
    async (payload: MessagePayload) => {
      // Message sent tracking
      logger.debug(`Message sent: ${payload.message.content.text}`)
    }
  ],

  [EventType.WORLD_JOINED]: [
    async (payload: WorldPayload) => {
      logger.debug(`World joined: ${payload.world.name}`)
      // await handleServerSync(payload)
    }
  ],

  [EventType.WORLD_CONNECTED]: [
    async (payload: WorldPayload) => {
      logger.debug(`World connected: ${payload.world.name}`)
      // await handleServerSync(payload)
    }
  ],

  [EventType.ENTITY_JOINED]: [
    async (payload: EntityPayload) => {
      logger.debug(`Entity joined: ${payload.entityId}`)
      // await syncSingleUser(
      //   payload.entityId,
      //   payload.runtime,
      //   payload.worldId,
      //   payload.roomId,
      //   payload.metadata.type,
      //   payload.source
      // )
    }
  ],

  [EventType.ENTITY_LEFT]: [
    async (payload: EntityPayload) => {
      try {
        // Update entity to inactive
        const entity = await payload.runtime.getEntityById(payload.entityId)
        if (entity) {
          entity.metadata = {
            ...entity.metadata,
            status: 'INACTIVE',
            leftAt: Date.now()
          }
          await payload.runtime.updateEntity(entity)
        }
        console.log(`User ${payload.entityId} left world ${payload.worldId}`)
      } catch (error) {
        console.error(
          `Error handling user left: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  ],

  [EventType.ACTION_STARTED]: [
    async (payload: ActionEventPayload) => {
      logger.debug(`Action started: ${payload.actionName} (${payload.actionId})`)
    }
  ],

  [EventType.ACTION_COMPLETED]: [
    async (payload: ActionEventPayload) => {
      const status = payload.error ? `failed: ${payload.error.message}` : 'completed'
      logger.debug(`Action ${status}: ${payload.actionName} (${payload.actionId})`)
    }
  ],

  [EventType.EVALUATOR_STARTED]: [
    async (payload: EvaluatorEventPayload) => {
      logger.debug(`Evaluator started: ${payload.evaluatorName} (${payload.evaluatorId})`)
    }
  ],

  [EventType.EVALUATOR_COMPLETED]: [
    async (payload: EvaluatorEventPayload) => {
      const status = payload.error ? `failed: ${payload.error.message}` : 'completed'
      logger.debug(`Evaluator ${status}: ${payload.evaluatorName} (${payload.evaluatorId})`)
    }
  ]
}

export const ayaPlugin: Plugin = {
  name: '@tribesxyz/ayaos',
  description: 'Aya plugin for interacting with the Aya network',
  actions: [replyAction, ignoreAction, webSearch, capabilitiesAction],
  evaluators: [],
  providers: [
    timeProvider,
    entitiesProvider,
    providersProvider,
    actionsProvider,
    characterProvider,
    recentMessagesProvider
  ],
  models: {},
  componentTypes: [],
  adapter: undefined,
  routes: [],
  tests: [],
  // eslint-disable-next-line max-len
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  events: events as any,
  services: [AyaClientService, WebSearchService]
}
