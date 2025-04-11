import { isNull } from '@/common/functions'
import { webSearch } from '@/plugins/aya/actions/websearch'
import { messageReceivedHandler } from '@/plugins/aya/events'
import { AyaClientService } from '@/plugins/aya/services/client'
import { WebSearchService } from '@/plugins/aya/services/websearch'
import { EventType, MessagePayload, Plugin } from '@elizaos/core'
import bootstrapPlugin from '@elizaos/plugin-bootstrap'

const actions = bootstrapPlugin.actions || []
const evaluators = bootstrapPlugin.evaluators || []
const providers = bootstrapPlugin.providers || []
const events = bootstrapPlugin.events || {}
const services = bootstrapPlugin.services || []
const models = bootstrapPlugin.models || {}
const componentTypes = bootstrapPlugin.componentTypes || []
const adapter = bootstrapPlugin.adapter
const routes = bootstrapPlugin.routes || []
const tests = bootstrapPlugin.tests || []

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
  actions: [...actions, webSearch],
  evaluators,
  providers,
  models,
  componentTypes,
  adapter,
  routes,
  tests,
  events,
  services: [...services, AyaClientService, WebSearchService]
}
