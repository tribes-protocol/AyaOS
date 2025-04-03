// import { AyaService } from '@/plugins/aya/service'
import { Plugin } from '@/common/iruntime'

export const agentcoinPlugin: Plugin = {
  name: 'agentcoin',
  description: 'Agentcoin plugin for interacting with the Agentcoin network',
  actions: [],
  evaluators: [],
  providers: [],
  services: [] // FIXME: hish - uncomment [AyaService]
}

export default agentcoinPlugin
