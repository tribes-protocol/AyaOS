import { isNull } from '@/common/functions'
import { PathResolver } from '@/common/path-resolver'
import { LoginManager } from '@/managers/admin'
import { KeychainManager } from '@/managers/keychain'

async function main(): Promise<void> {
  try {
    // get data directory from command line args
    const dataDir = process.argv[2]
    const agentName = process.argv[3] || undefined
    const agentPurpose = process.argv[4] || undefined

    if (isNull(dataDir)) {
      console.error('please provide a data directory path as the first argument')
      process.exit(1)
    }

    // initialize path resolver with data directory
    const pathResolver = new PathResolver(dataDir)

    // initialize keychain service
    const keychainManager = new KeychainManager(pathResolver.keypairFile)

    // initialize agentcoin service
    const agentcoinService = new LoginManager(keychainManager, pathResolver)

    // provision if needed
    await agentcoinService.provisionIfNeeded(agentName, agentPurpose)

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
