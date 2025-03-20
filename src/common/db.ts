import { isNull } from '@/common/functions'
import { AyaPostgresDatabaseAdapter } from '@/databases/postgres/adapter'
import { IDatabaseAdapter, IDatabaseCacheAdapter } from '@elizaos/core'

export async function initializeDatabase(): Promise<IDatabaseAdapter & IDatabaseCacheAdapter> {
  if (isNull(process.env.POSTGRES_URL)) {
    throw new Error('POSTGRES_URL is not set')
  }

  const db = new AyaPostgresDatabaseAdapter({
    connectionString: process.env.POSTGRES_URL
  })
  await db.init()
  return db
}
