import { isNull } from '@/common/functions'
import { IAyaDatabaseAdapter } from '@/databases/interfaces'
import { AyaPostgresDatabaseAdapter } from '@/databases/postgres/adapter'
import { AyaSqliteDatabaseAdapter } from '@/databases/sqlite/adapter'

export async function initializeDatabase(dbFile: string): Promise<IAyaDatabaseAdapter> {
  if (isNull(process.env.POSTGRES_URL)) {
    const adapter = new AyaSqliteDatabaseAdapter(dbFile)
    await adapter.init()
    return adapter
  }

  const db = new AyaPostgresDatabaseAdapter({
    connectionString: process.env.POSTGRES_URL
  })
  await db.init()
  return db
}
