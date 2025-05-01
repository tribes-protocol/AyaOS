import { Agent } from '@/agent/agent'

async function main(): Promise<void> {
  try {
    console.log('hello, agent ->', process.env.DATA_DIR)
    const agent = new Agent({ dataDir: process.env.DATA_DIR })

    await agent.start()
  } catch (error) {
    console.error(`error:`, error)
    process.exit(1)
  }
}

main().catch(console.error)
