import { ensureString } from '@/common/functions'

export const AGENTCOIN_FUN_API_URL = process.env.AGENTCOIN_FUN_API_URL || 'https://agentcoin.fun'

export const AGENTCOIN_MONITORING_ENABLED = process.env.AGENTCOIN_MONITORING_ENABLED === 'true'

export const POSTGRES_URL = ensureString(process.env.POSTGRES_URL, 'POSTGRES_URL is not set')

export const AGENT_ADMIN_PUBLIC_KEY =
  process.env.AGENT_ADMIN_PUBLIC_KEY ||
  '02ef90c742e3a447ceec17330d4eccedf8b604487b0cda150c3e1babcbd4076967'
