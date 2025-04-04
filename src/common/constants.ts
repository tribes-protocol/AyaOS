import os from 'os'
import path from 'path'

// UUID regex pattern with 5 groups of hexadecimal digits separated by hyphens
export const UUID_PATTERN = /^[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+$/i

export const USER_CREDENTIALS_FILE = path.join(os.homedir(), '.ayaos', 'credentials.json')

export const AYA_SOURCE = 'aya'

export const LLM_PROXY = 'https://aya-proxies.hish.workers.dev/v1/tools/llm'

export const WEBSEARCH_PROXY = 'https://aya-proxies.hish.workers.dev/v1/tools/search'

export const DEFAULT_SMALL_MODEL = 'qwen/qwq-32b'

export const DEFAULT_LARGE_MODEL = 'meta/llama-3.3-70b-instruct-fp8'

export const DEFAULT_EMBEDDING_MODEL = 'baai/bge-large-en-v1.5'

export const DEFAULT_EMBEDDING_DIMENSIONS = '1024'
