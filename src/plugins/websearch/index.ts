import { Plugin } from '@/common/iruntime'
import { webSearch } from '@/plugins/websearch/actions/websearch'
import { WebSearchService } from '@/plugins/websearch/services/websearch'

export const webSearchPlugin: Plugin = {
  name: 'webSearch',
  description: 'Search the web and get news',
  actions: [webSearch],
  evaluators: [],
  providers: [],
  services: [WebSearchService]
}

export default webSearchPlugin
