import { Agent } from '@/agent/agent'
import { ayaLogger } from '@/common/logger'
import { openRouterPlugin, seedOracle } from '@/oracle'

async function main(): Promise<void> {
  try {
    console.log('hello, agent ->', process.env.DATA_DIR)
    const agent = new Agent({ dataDir: process.env.DATA_DIR })
    await agent.register('action', seedOracle)
    await agent.register('plugin', openRouterPlugin)

    await agent.start()
  } catch (error) {
    console.error(`error:`, error)
    process.exit(1)
  }
}

main().catch(ayaLogger.error)
