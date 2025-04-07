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

export const LLM_PROXY = 'https://aya-proxies.hish.workers.dev/v1/tools/llm'

export const WEBSEARCH_PROXY = 'https://aya-proxies.hish.workers.dev/v1/tools/search'

export const KNOWLEDGE_TABLE_NAME = 'knowledge'

export const DOCUMENT_TABLE_NAME = 'documents'

export const DEFAULT_SMALL_MODEL = 'qwen/qwq-32b'

export const DEFAULT_LARGE_MODEL = 'meta/llama-3.3-70b-instruct-fp8'

export const DEFAULT_EMBEDDING_MODEL = 'baai/bge-large-en-v1.5'

export const DEFAULT_EMBEDDING_DIMENSIONS = '1024'

export const AYA_JWT_COOKIE_NAME = 'jwt_auth_token'

export const AYA_JWT_SETTINGS_KEY = 'AYA_JWT_SETTINGS_KEY'

export const AYA_AGENT_IDENTITY_KEY = 'AYA_AGENT_IDENTITY_KEY'

export const AYA_AGENT_DATA_DIR_KEY = 'AYA_AGENT_DATA_DIR_KEY'
