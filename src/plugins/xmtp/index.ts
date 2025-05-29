import { XMTPService } from '@/plugins/xmtp/service'
import { elizaLogger, Plugin } from '@elizaos/core'

const xmtpPlugin: Plugin = {
  name: 'xmtp',
  description: 'XMTP client',
  services: [XMTPService],
  tests: [],
  init: async (_config, runtime) => {
    elizaLogger.info('xmtpPlugin init for agentId', runtime.agentId)
  }
}
export default xmtpPlugin
