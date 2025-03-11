import path from 'path'
import os from 'os'
import fs from 'fs'
// UUID regex pattern with 5 groups of hexadecimal digits separated by hyphens
export const UUID_PATTERN = /^[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+$/i

export const AGENTCOIN_FUN_DIR = path.join(os.homedir(), '.agentcoin-fun')

export const AGENTCOIN_MONITORING_ENABLED = process.env.AGENTCOIN_MONITORING_ENABLED === 'true'

// make sure the `.agentcoin-fun` directory exists
if (!fs.existsSync(AGENTCOIN_FUN_DIR)) {
  fs.mkdirSync(AGENTCOIN_FUN_DIR, { recursive: true })
}
