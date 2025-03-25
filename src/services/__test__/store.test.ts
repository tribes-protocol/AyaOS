import { Agent } from '@/agent/agent'
import { ayaLogger } from '@/common/logger'

async function main(): Promise<void> {
  try {
    const agent = new Agent({ dataDir: 'store_test' })

    await agent.start()
    ayaLogger.info('agent started', agent.agentId)
  } catch (error) {
    ayaLogger.error(`error:`, error)
    process.exit(1)
  }
}

main().catch(ayaLogger.error)
