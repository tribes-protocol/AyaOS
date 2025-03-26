import { conversationProvider } from '@/plugins/aya/providers/conversation'
import { AyaService } from '@/plugins/aya/service'
import { Plugin } from '@elizaos/core'

export const agentcoinPlugin: Plugin = {
  name: 'agentcoin',
  description: 'Agentcoin plugin for interacting with the Agentcoin network',
  actions: [],
  evaluators: [],
  providers: [conversationProvider],
  services: [AyaService]
}

export default agentcoinPlugin
