import { Agent } from '@/agent/agent'
import { ayaLogger } from '@/common/logger'
import { MemoryFilters } from '@/common/types'
import { IStoreService, StoreItem } from '@/services/interfaces'

async function main(): Promise<void> {
  try {
    const agent = new Agent({ dataDir: 'data_test' })
    await agent.start()
    ayaLogger.info('Agent started', agent.agentId)

    const store = agent.store
    const tableName = 'filter_test'

    ayaLogger.info('Cleaning up previous test data')
    const existingItems = await store.filter({ table: tableName, filters: {} })
    for (const item of existingItems) {
      await store.delete({ table: tableName, id: item.id })
    }

    // Insert test data
    ayaLogger.info('Inserting test data')
    await insertTestData(store, tableName)

    // Test different filter types
    await testSimpleFilter(store, tableName)
    await testArrayFilter(store, tableName)
    await testComparisonOperators(store, tableName)
    await testBooleanFilter(store, tableName)
    await testCombinedFilters(store, tableName)

    ayaLogger.info('All tests completed successfully!')
  } catch (error) {
    console.error(error)
    ayaLogger.error(`Error:`, error)
    process.exit(1)
  }
}

async function insertTestData(store: IStoreService, table: string): Promise<void> {
  const testItems = [
    {
      name: 'John',
      age: 25,
      active: true,
      tags: ['developer', 'frontend'],
      score: 85,
      metadata: { level: 'senior', department: 'engineering' }
    },
    {
      name: 'Alice',
      age: 30,
      active: true,
      tags: ['manager', 'backend'],
      score: 92,
      metadata: { level: 'senior', department: 'product' }
    },
    {
      name: 'Bob',
      age: 22,
      active: false,
      tags: ['developer', 'intern'],
      score: 70,
      metadata: { level: 'junior', department: 'engineering' }
    },
    {
      name: 'Sarah',
      age: 28,
      active: true,
      tags: ['designer', 'frontend'],
      score: 88,
      metadata: { level: 'mid', department: 'design' }
    },
    {
      name: 'Michael',
      age: 35,
      active: false,
      tags: ['developer', 'backend', 'senior'],
      score: 95,
      metadata: { level: 'senior', department: 'engineering' }
    }
  ]

  for (const item of testItems) {
    await store.insert({
      table,
      data: item,
      embedding: await store.embed(item.name)
    })
  }

  ayaLogger.info(`Inserted ${testItems.length} test items`)
}

async function testSimpleFilter(store: IStoreService, table: string): Promise<void> {
  ayaLogger.info('Testing simple equality filters')

  // Test exact match on string
  const nameFilter: MemoryFilters = { name: 'John' }
  const nameResults = await store.filter({ table, filters: nameFilter })
  logResults('Name filter (John)', nameResults)

  // Test exact match on number
  const ageFilter: MemoryFilters = { age: 30 }
  const ageResults = await store.filter({ table, filters: ageFilter })
  logResults('Age filter (30)', ageResults)

  // Test nested property
  const departmentFilter: MemoryFilters = { 'metadata.department': 'engineering' }
  const departmentResults = await store.filter({ table, filters: departmentFilter })
  logResults('Department filter (engineering)', departmentResults)
}

async function testArrayFilter(store: IStoreService, table: string): Promise<void> {
  ayaLogger.info('Testing array filters')

  const tagsFilter: MemoryFilters = { name: { $in: ['John', 'Alice'] } }
  const tagsResults = await store.filter({ table, filters: tagsFilter })
  logResults('Tags filter (John, Alice)', tagsResults)

  // Test array with $contains
  const tagsContainsFilter: MemoryFilters = { tags: { $contains: ['frontend'] } }
  const tagsContainsResults = await store.filter({ table, filters: tagsContainsFilter })
  logResults('Tags contains filter (frontend)', tagsContainsResults)
}

async function testComparisonOperators(store: IStoreService, table: string): Promise<void> {
  ayaLogger.info('Testing comparison operators')

  // Test greater than
  const gtFilter: MemoryFilters = { age: { $gt: 28 } }
  const gtResults = await store.filter({ table, filters: gtFilter })
  logResults('Age > 28', gtResults)

  // Test greater than or equal
  const gteFilter: MemoryFilters = { age: { $gte: 30 } }
  const gteResults = await store.filter({ table, filters: gteFilter })
  logResults('Age >= 30', gteResults)

  // Test less than
  const ltFilter: MemoryFilters = { age: { $lt: 25 } }
  const ltResults = await store.filter({ table, filters: ltFilter })
  logResults('Age < 25', ltResults)

  // Test less than or equal
  const lteFilter: MemoryFilters = { age: { $lte: 25 } }
  const lteResults = await store.filter({ table, filters: lteFilter })
  logResults('Age <= 25', lteResults)

  // Test not equal
  const neFilter: MemoryFilters = { name: { $ne: 'John' } }
  const neResults = await store.filter({ table, filters: neFilter })
  logResults('Name != John', neResults)

  // Test equals with $eq
  const eqFilter: MemoryFilters = { score: { $eq: 95 } }
  const eqResults = await store.filter({ table, filters: eqFilter })
  logResults('Score = 95', eqResults)
}

async function testBooleanFilter(store: IStoreService, table: string): Promise<void> {
  ayaLogger.info('Testing boolean filters')

  // Test boolean true
  const activeFilter: MemoryFilters = { active: true }
  const activeResults = await store.filter({ table, filters: activeFilter })
  logResults('Active = true', activeResults)

  // Test boolean false
  const inactiveFilter: MemoryFilters = { active: false }
  const inactiveResults = await store.filter({ table, filters: inactiveFilter })
  logResults('Active = false', inactiveResults)
}

async function testCombinedFilters(store: IStoreService, table: string): Promise<void> {
  ayaLogger.info('Testing combined filters')

  // Test multiple conditions
  const combinedFilter: MemoryFilters = {
    age: { $gt: 25 },
    active: true,
    'metadata.level': 'senior'
  }
  const combinedResults = await store.filter({ table, filters: combinedFilter })
  logResults('Combined filter (age > 25, active = true, level = senior)', combinedResults)

  // Test with limit
  const limitResults = await store.filter({
    table,
    filters: { active: true },
    limit: 2
  })
  logResults('Active = true with limit 2', limitResults)
}

function logResults(testName: string, results: StoreItem[]): void {
  ayaLogger.info(`${testName}: Found ${results.length} items`)

  if (results.length > 0) {
    const simplifiedResults = results.map((item) => ({
      id: item.id.substring(0, 8) + '...',
      data: item.data
    }))

    ayaLogger.info(JSON.stringify(simplifiedResults, null, 2))
  }
}

main().catch(console.error)
