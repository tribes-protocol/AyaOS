import { Agent } from '@/agent/agent'
import { ayaLogger } from '@/common/logger'
async function main(): Promise<void> {
  try {
    ayaLogger.info({ dataDir: process.env.DATA_DIR }, 'hello, agent')
    const agent = new Agent({ dataDir: process.env.DATA_DIR })

    await agent.start()
  } catch (error) {
    ayaLogger.error({ err: error }, 'An error occurred')

    process.exit(1)
  }
}

main().catch(console.error)
