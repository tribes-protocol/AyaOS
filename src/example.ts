import { Agent } from '@/agent/agent'
import { ayaLogger } from '@/common/logger'
import { seedOracle } from '@/oracle'

async function main(): Promise<void> {
  try {
    process.env.DATA_DIR = '/Users/hish/Data/seed-sniper'
    console.log('hello, SeedSniper ->', process.env.DATA_DIR)
    const agent = new Agent({ dataDir: process.env.DATA_DIR })
    await agent.register('action', seedOracle)

    await agent.start()
  } catch (error) {
    console.error(`error:`, error)
  }
}

main().catch(ayaLogger.error)
