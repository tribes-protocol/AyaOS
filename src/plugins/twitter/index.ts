import { TwitterService } from '@/plugins/twitter/service'
import { elizaLogger, Plugin } from '@elizaos/core'

const twitterPlugin: Plugin = {
  name: 'twitter',
  description: 'Twitter/X client for posting tweets',
  services: [TwitterService],
  tests: [],
  init: async (_config, runtime) => {
    elizaLogger.info('twitterPlugin init for agentId', runtime.agentId)
  }
}

export default twitterPlugin
