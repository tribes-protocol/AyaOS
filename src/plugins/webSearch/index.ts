import { webSearch } from '@/plugins/webSearch/actions/webSearch'
import { WebSearchService } from '@/plugins/webSearch/services/webSearchService'

export const webSearchPlugin = {
  name: 'webSearch',
  description: 'Search the web and get news',
  actions: [webSearch],
  evaluators: [],
  providers: [],
  services: [new WebSearchService()],
  clients: [],
  adapters: []
}

export default webSearchPlugin
