import 'dotenv/config'

export const AGENTCOIN_FUN_API_URL = process.env.AGENTCOIN_FUN_API_URL || 'https://ayaos.ai'

export const AGENTCOIN_MONITORING_ENABLED = process.env.AGENTCOIN_MONITORING_ENABLED === 'TRUE'

export const AGENT_ADMIN_PUBLIC_KEY =
  process.env.AGENT_ADMIN_PUBLIC_KEY ||
  '02ef90c742e3a447ceec17330d4eccedf8b604487b0cda150c3e1babcbd4076967'

//
