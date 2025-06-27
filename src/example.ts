import { Agent } from '@/agent/agent'

import { ayaLogger } from '@/common/logger'
import { webSearch } from '@/plugins/aya/actions/websearch'

async function main(): Promise<void> {
  try {
    ayaLogger.info('hello, agent', { dataDir: process.env.DATA_DIR })
    const agent = new Agent({ dataDir: process.env.DATA_DIR })

    await agent.register('action', webSearch)

    await agent.start()
    ayaLogger.info('example agent started')
  } catch (error) {
    ayaLogger.error('An error occurred', { error })

    process.exit(1)
  }
}

main().catch(ayaLogger.error)
