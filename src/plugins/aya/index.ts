import { isNull } from '@/common/functions'
import { messageReceivedHandler } from '@/plugins/aya/events'
import { AyaClientService } from '@/plugins/aya/services/client'
import { WebSearchService } from '@/plugins/aya/services/websearch'
import { EventType, IAgentRuntime, MessagePayload, Plugin } from '@elizaos/core'
import bootstrapPlugin from '@elizaos/plugin-bootstrap'

const actions = bootstrapPlugin.actions || []
const evaluators = bootstrapPlugin.evaluators || []
const providers = bootstrapPlugin.providers || []
const events = bootstrapPlugin.events || {}
const services = bootstrapPlugin.services || []

events[EventType.MESSAGE_RECEIVED] = [
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
]

// TODO: hish - plugin-bootstrap is overriding this with the wrong type
// ayaBootstrapPlugin.events[EventType.VOICE_MESSAGE_RECEIVED] =[]
events[EventType.VOICE_MESSAGE_RECEIVED] = []

export const ayaPlugin: Plugin = {
  name: '@tribesxyz/ayaos',
  description: 'Aya plugin for interacting with the Aya network',
  actions,
  evaluators,
  providers,
  events,
  services: [...services, AyaClientService, WebSearchService],
  init: async (_config: Record<string, string>, _runtime: IAgentRuntime) => {
    console.log(' init aya plugin')
  }
}
