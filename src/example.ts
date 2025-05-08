import { Agent } from '@/agent/agent'

import { ayaLogger } from '@/common/logger'

async function main(): Promise<void> {
  try {
    ayaLogger.info('hello, agent', { dataDir: process.env.DATA_DIR })
    const agent = new Agent({ dataDir: process.env.DATA_DIR })

    await agent.start()
  } catch (error) {
    ayaLogger.error('An error occurred', { error })

    process.exit(1)
  }
}

main().catch(console.error)
