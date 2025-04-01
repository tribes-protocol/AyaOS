// import { AyaService } from '@/plugins/aya/service'
import { Plugin } from '@elizaos/core'

export const agentcoinPlugin: Plugin = {
  name: 'agentcoin',
  description: 'Agentcoin plugin for interacting with the Agentcoin network',
  actions: [],
  evaluators: [],
  providers: [],
  services: [] // FIXME: hish - uncomment [AyaService]
}

export default agentcoinPlugin
