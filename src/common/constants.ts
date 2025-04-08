import fs from 'fs'
import os from 'os'
import path from 'path'

// UUID regex pattern with 5 groups of hexadecimal digits separated by hyphens
export const UUID_PATTERN = /^[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+$/i

export const USER_CREDENTIALS_FILE = path.join(os.homedir(), '.ayaos', 'credentials.json')

// Ensure the .ayaos directory exists
const AYA_CONFIG_DIR = path.join(os.homedir(), '.ayaos')
if (!fs.existsSync(AYA_CONFIG_DIR)) {
  fs.mkdirSync(AYA_CONFIG_DIR, { recursive: true })
}

export const AGENTCOIN_FUN_API_URL = 'https://api.agentcoin.fun'

export const AYA_SOURCE = 'aya'

export const BASE_PROXY_URL = 'https://aya-proxies.hish.workers.dev'

export const LLM_PROXY = `${BASE_PROXY_URL}/v1/tools/llm`

export const WEBSEARCH_PROXY = `${BASE_PROXY_URL}/v1/tools/search`

export const DEFAULT_SMALL_MODEL = 'meta/llama-3.3-70b-instruct-fp8'

export const DEFAULT_LARGE_MODEL = 'meta/llama-3.3-70b-instruct-fp8'

export const DEFAULT_EMBEDDING_MODEL = 'baai/bge-large-en-v1.5'

export const DEFAULT_EMBEDDING_DIMENSIONS = '1024'

export const AYA_JWT_COOKIE_NAME = 'jwt_auth_token'

export const AYA_JWT_SETTINGS_KEY = 'AYA_JWT_SETTINGS_KEY'

export const AYA_AGENT_IDENTITY_KEY = 'AYA_AGENT_IDENTITY_KEY'

export const AYA_AGENT_DATA_DIR_KEY = 'AYA_AGENT_DATA_DIR_KEY'

export const OPENAI_API_KEY = 'OPENAI_API_KEY'

export const PGLITE_DATA_DIR = 'PGLITE_DATA_DIR'

export const CHARACTERS_DIR = path.join(process.cwd(), 'src', 'characters')
if (!fs.existsSync(CHARACTERS_DIR)) {
  fs.mkdirSync(CHARACTERS_DIR, { recursive: true })
}
