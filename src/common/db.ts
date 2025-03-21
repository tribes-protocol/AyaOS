import { isNull } from '@/common/functions'
import { AyaPostgresDatabaseAdapter } from '@/databases/postgres/adapter'
import { SqliteDatabaseAdapter } from '@elizaos/adapter-sqlite'
import { IDatabaseAdapter, IDatabaseCacheAdapter } from '@elizaos/core'
import Database from 'better-sqlite3'

export async function initializeDatabase(
  dbFile: string
): Promise<IDatabaseAdapter & IDatabaseCacheAdapter> {
  if (isNull(process.env.POSTGRES_URL)) {
    const db = new Database(dbFile)
    const adapter = new SqliteDatabaseAdapter(db)
    await adapter.init()
    return adapter
  }

  const db = new AyaPostgresDatabaseAdapter({
    connectionString: process.env.POSTGRES_URL
  })
  await db.init()
  return db
}
