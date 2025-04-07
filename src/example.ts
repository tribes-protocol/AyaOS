import { Agent } from '@/agent/agent'
import { ayaLogger } from '@/common/logger'

async function main(): Promise<void> {
  try {
    console.log('hello, agent!')
    const agent = new Agent({ dataDir: 'data' })
    await agent.start()
  } catch (error) {
    console.error(`error:`, error)
    process.exit(1)
  }
}

main().catch(ayaLogger.error)
