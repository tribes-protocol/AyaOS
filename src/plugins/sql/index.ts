import { ayaLogger } from '@/common/logger'
import { IAgentRuntime, logger, Plugin } from '@elizaos/core'
import { createDatabaseAdapter } from '@elizaos/plugin-sql'

const sqlPlugin: Plugin = {
  name: 'sql',
  description: 'SQL database adapter plugin using Drizzle ORM',
  init: async (_, runtime: IAgentRuntime) => {
    ayaLogger.info('Initializing AyaOS SQL plugin')
    const config = {
      dataDir: runtime.getSetting('PGLITE_DATA_DIR') ?? './pglite',
      postgresUrl: runtime.getSetting('POSTGRES_URL') ?? process.env.POSTGRES_URL
    }

    try {
      const db = createDatabaseAdapter(config, runtime.agentId)
      logger.success('Database connection established successfully')
      runtime.registerDatabaseAdapter(db)
    } catch (error) {
      logger.error('Failed to initialize database:', error)
      throw error
    }
  }
}

export default sqlPlugin
