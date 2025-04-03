import { AyaService } from '@/plugins/aya/service'
import { Plugin } from '@elizaos/core'

export const ayaPlugin: Plugin = {
  name: 'aya',
  description: 'Aya plugin for interacting with the Aya network',
  actions: [],
  evaluators: [],
  providers: [],
  services: [AyaService]
}

export default ayaPlugin
