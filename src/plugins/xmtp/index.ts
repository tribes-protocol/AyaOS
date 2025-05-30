import { ayaLogger } from '@/common/logger'
import { XMTPService } from '@/plugins/xmtp/service'
import { Plugin } from '@elizaos/core'

const xmtpPlugin: Plugin = {
  name: 'xmtp',
  description: 'XMTP client',
  services: [XMTPService],
  tests: [],
  init: async (_config, runtime) => {
    ayaLogger.info('xmtpPlugin init for agentId', runtime.agentId)
  }
}
export default xmtpPlugin
