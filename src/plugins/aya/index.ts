import { Plugin } from '@/common/iruntime'
import { AyaService } from '@/plugins/aya/service'

export const ayaPlugin: Plugin = {
  name: 'aya',
  description: 'Aya plugin for interacting with the Aya network',
  actions: [],
  evaluators: [],
  providers: [],
  services: [AyaService]
}

export default ayaPlugin
