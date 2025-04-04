import os from 'os'
import path from 'path'

// Ensure the directory exists
import fs from 'fs'
// UUID regex pattern with 5 groups of hexadecimal digits separated by hyphens
export const UUID_PATTERN = /^[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+$/i

const AGENTCOIN_FUN_DIR = path.join(os.homedir(), '.agentcoin-fun')
export const USER_CREDENTIALS_FILE = path.join(AGENTCOIN_FUN_DIR, 'credentials.json')

if (!fs.existsSync(AGENTCOIN_FUN_DIR)) {
  fs.mkdirSync(AGENTCOIN_FUN_DIR, { recursive: true })
}

export const CHARACTERS_DIR = path.join(process.cwd(), 'src', 'characters')
if (!fs.existsSync(CHARACTERS_DIR)) {
  fs.mkdirSync(CHARACTERS_DIR, { recursive: true })
}
