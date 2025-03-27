import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { isNull } from '@/common/functions'
import { PathResolver } from '@/common/path-resolver'
import { AgentcoinService } from '@/services/agentcoinfun'
import { KeychainService } from '@/services/keychain'

async function main(): Promise<void> {
  try {
    // get data directory from command line args
    const dataDir = process.argv[2]
    if (isNull(dataDir)) {
      console.error('please provide a data directory path as the first argument')
      process.exit(1)
    }

    // initialize path resolver with data directory
    const pathResolver = new PathResolver(dataDir)

    // initialize keychain service
    const keychainService = new KeychainService(pathResolver.keypairFile)

    // initialize agentcoin api
    const agentcoinAPI = new AgentcoinAPI()

    // initialize agentcoin service
    const agentcoinService = new AgentcoinService(keychainService, agentcoinAPI, pathResolver)

    // provision if needed
    await agentcoinService.provisionIfNeeded()

    console.log('agent provisioning completed successfully')
  } catch (error) {
    if (error instanceof Error) {
      console.error('failed to provision agent:', error)
    } else {
      console.error('failed to provision agent:', error)
    }
    process.exit(1)
  }
}

// run main function
void main()
