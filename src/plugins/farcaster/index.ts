import { FarcasterService } from '@/plugins/farcaster/service'
import type { Plugin } from '@elizaos/core'

const farcasterPlugin: Plugin = {
  name: 'farcaster',
  description: 'Farcaster client plugin',
  services: [FarcasterService],
  tests: [],
  init: async (_config, runtime) => {
    console.log('farcasterPlugin init for agentId', runtime.agentId)
  }
}
export default farcasterPlugin
