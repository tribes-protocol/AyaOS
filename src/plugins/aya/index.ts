import { Plugin } from '@/common/iruntime'
import { AyaService } from '@/plugins/aya/service'
import { WebSearchService } from '@/plugins/aya/services/websearch'
import { IAgentRuntime } from '@elizaos/core'

export const ayaPlugin: Plugin = {
  name: 'aya',
  description: 'Aya plugin for interacting with the Aya network',
  actions: [],
  evaluators: [],
  providers: [],
  services: [AyaService, WebSearchService],
  init: async (_config: Record<string, string>, _runtime: IAgentRuntime) => {
    // TODO: initialize services
  }
}

export default ayaPlugin
