#!/usr/bin/env node

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import * as readline from 'readline/promises' // Node 18+
import { fileURLToPath } from 'url'

// ----------------------------------------------------------------------------
// 1. Validate CLI arguments
// ----------------------------------------------------------------------------
const args = process.argv.slice(2)

// This script expects: `ayaos init`
if (args.length !== 1) {
  console.error("Error: 'init' command required")
  console.error('Usage: ayaos init')
  process.exit(1)
}

if (args[0] !== 'init') {
  console.error(`Error: Invalid argument '${args[0]}'`)
  console.error('Usage: ayaos init')
  process.exit(1)
}

// ----------------------------------------------------------------------------
// 2. Check if Bun is installed
// ----------------------------------------------------------------------------
try {
  // If 'bun --version' fails, we'll catch the error
  execSync('bun --version', { stdio: 'ignore' })
} catch (err) {
  console.error('Bun is not installed. Please install it first:')
  console.error('curl -fsSL https://bun.sh/install | bash')
  process.exit(1)
}

// ----------------------------------------------------------------------------
// 3. Environment debug info
// ----------------------------------------------------------------------------
console.log('===== ENVIRONMENT DEBUG =====')
console.log('Current working directory:', process.cwd())
console.log('PATH:', process.env.PATH)
try {
  const whichBun = execSync('command -v bun').toString().trim()
  console.log('Which bun:', whichBun)
} catch {
  console.log('Which bun: (not found)')
}
console.log('Shell:', process.env.SHELL || 'unknown')
console.log('=============================')

// ----------------------------------------------------------------------------
// 4. Prompt user for input
// ----------------------------------------------------------------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

let projectName = ''
let dataDir = ''
let agentName = ''
let agentPurpose = ''

async function askQuestions() {
  projectName = await rl.question('What do you want to name the project? ')

  // Keep asking for dataDir until we get a valid path
  while (true) {
    dataDir = await rl.question(
      'Where do you want the data directory to be? (Please provide full path) '
    )
    if (!dataDir) {
      console.error('Data directory path is required. Exiting...')
      process.exit(1)
    }
    // Expand ~ to home directory if present
    if (dataDir.startsWith('~')) {
      dataDir = dataDir.replace('~', process.env.HOME || '')
    }
    // Validate that dataDir is a full path
    if (!dataDir.startsWith('/')) {
      console.error("Error: Please provide a full path starting with '/' or '~'")
      continue
    }
    // If we get here, we have a valid dataDir
    break
  }

  agentName = await rl.question("What is your agent's name? ")
  agentPurpose = await rl.question("What is your agent's purpose? ")

  await rl.close()
}

await askQuestions()

// ----------------------------------------------------------------------------
// 5. Clone the repository
// ----------------------------------------------------------------------------
try {
  execSync(`git clone https://github.com/tribes-protocol/agent "${projectName}"`, {
    stdio: 'inherit'
  })
} catch (err) {
  console.error('Failed to clone repository:', err.message)
  process.exit(1)
}

// Remove .git directory
const gitDir = path.join(projectName, '.git')
try {
  fs.rmSync(gitDir, { recursive: true, force: true })
} catch (err) {
  // If it doesn't exist, that's fine
}

// ----------------------------------------------------------------------------
// 6. Create .env file with data directory
// ----------------------------------------------------------------------------
const envContents = `DATA_DIR="${dataDir}"\n`
fs.writeFileSync(path.join(projectName, '.env'), envContents, 'utf8')

// ----------------------------------------------------------------------------
// 7. Install dependencies with Bun
// ----------------------------------------------------------------------------
const originalDir = process.cwd()
try {
  console.log(`===== Installing dependencies in ${path.join(originalDir, projectName)} =====`)
  execSync('bun i', { stdio: 'inherit', cwd: path.join(originalDir, projectName) })
} catch (err) {
  console.error('Failed to install dependencies')
  process.exit(1)
}

// ----------------------------------------------------------------------------
// 8. Create the data directory if it doesn't exist
// ----------------------------------------------------------------------------
fs.mkdirSync(dataDir, { recursive: true })

// ----------------------------------------------------------------------------
// 9. Determine the script location (project root of our package)
// ----------------------------------------------------------------------------
// Because this script might be symlinked, we'll rely on import.meta.url
const __filename = fileURLToPath(import.meta.url)
const scriptDir = path.dirname(__filename)
const projectRoot = path.resolve(scriptDir, '..')

console.log('===== SCRIPT LOCATION DEBUG =====')
console.log('Script directory (scriptDir):', scriptDir)
try {
  execSync(`ls -la "${scriptDir}"`, { stdio: 'inherit' })
} catch {
  console.log('(Could not list scriptDir contents.)')
}

console.log('\nPROJECT_ROOT:', projectRoot)
try {
  execSync(`ls -la "${projectRoot}"`, { stdio: 'inherit' })
} catch {
  console.log('(Could not list projectRoot contents.)')
}

console.log('\nListing contents of PROJECT_ROOT/scripts:')
try {
  execSync(`ls -la "${path.join(projectRoot, 'scripts')}"`, { stdio: 'inherit' })
} catch {
  console.log(`No scripts directory found at ${path.join(projectRoot, 'scripts')}`)
}
console.log()

// ----------------------------------------------------------------------------
// 10. Check explicitly if create-agent.ts exists
// ----------------------------------------------------------------------------
const createAgentPath = path.join(projectRoot, 'scripts', 'create-agent.ts')
if (!fs.existsSync(createAgentPath)) {
  console.error(`ERROR: ${createAgentPath} does NOT exist.`)
  console.error('Terminating.')
  process.exit(1)
}

// ----------------------------------------------------------------------------
// 11. Run create-agent.ts with Bun
// ----------------------------------------------------------------------------
console.log('===== RUNNING create-agent.ts =====')
try {
  // If you need 'tsx', do: `bun run tsx ${createAgentPath} ...`
  // or: `bun x tsx ${createAgentPath} ...`
  execSync(`bun run "${createAgentPath}" "${dataDir}" "${agentName}" "${agentPurpose}"`, {
    stdio: 'inherit',
    cwd: path.join(originalDir, projectName)
  })
} catch (err) {
  console.error('Failed to create agent')
  process.exit(1)
}

// ----------------------------------------------------------------------------
// 12. Final success message
// ----------------------------------------------------------------------------
console.log()
console.log('┌──────────────────────────────────────────────────────────────────────┐')
console.log('│                                                                      │')
console.log('│  ✓ Repository cloned successfully!                                   │')
console.log('│                                                                      │')
console.log('│  Next steps:                                                         │')
console.log('│                                                                      │')
console.log(`│  1. cd ${projectName}                                                │`)
console.log('│                                                                      │')
console.log('│  2. Add your OpenAI API key to .env:                                 │')
console.log('│     OPENAI_API_KEY=your_api_key_here                                 │')
console.log('│                                                                      │')
console.log('│  3. Run the development server with: bun dev                         │')
console.log('│                                                                      │')
console.log('└──────────────────────────────────────────────────────────────────────┘')
console.log()
