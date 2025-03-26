import { Agent } from '@/agent/agent'
import { ayaLogger } from '@/common/logger'
import { MemoryFilters } from '@/common/types'
import { IStoreService } from '@/services/interfaces'
import assert from 'assert'

interface TestPersonData {
  name: string
  age: number
  active: boolean
  tags: string[]
  score: number
  metadata: {
    level: string
    department: string
  }
}

// Helper function to safely access TestPerson properties
function isTestPersonData(data: Record<string, unknown>): boolean {
  return (
    data !== null &&
    typeof data === 'object' &&
    'name' in data &&
    'age' in data &&
    'active' in data &&
    Array.isArray(data.tags) &&
    typeof data.score === 'number' &&
    data.metadata !== undefined &&
    typeof data.metadata === 'object'
  )
}

function getPersonData(data: Record<string, unknown>): TestPersonData {
  if (!isTestPersonData(data)) {
    throw new Error('Data does not match TestPersonData structure')
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return data as unknown as TestPersonData
}

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
    process.exit(0)
  } catch (error) {
    console.error(error)
    ayaLogger.error(`Error:`, error)
    process.exit(1)
  }
}

async function insertTestData(store: IStoreService, table: string): Promise<void> {
  const testItems: TestPersonData[] = [
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
      data: { ...item }, // Spread operator creates a proper Record<string, unknown>
      embedding: await store.embed(item.name)
    })
  }

  const items = await store.filter({ table, filters: {} })
  assert.strictEqual(
    items.length,
    testItems.length,
    `Should have inserted ${testItems.length} items`
  )
  ayaLogger.info(`Inserted ${testItems.length} test items`)
}

async function testSimpleFilter(store: IStoreService, table: string): Promise<void> {
  ayaLogger.info('Testing simple equality filters')

  // Test exact match on string
  const nameFilter: MemoryFilters = { name: 'John' }
  const nameResults = await store.filter({ table, filters: nameFilter })
  assert.strictEqual(nameResults.length, 1, 'Name filter should return exactly 1 item')
  assert.strictEqual(
    getPersonData(nameResults[0].data).name,
    'John',
    'Name filter should return John'
  )

  // Test exact match on number
  const ageFilter: MemoryFilters = { age: 30 }
  const ageResults = await store.filter({ table, filters: ageFilter })
  assert.strictEqual(ageResults.length, 1, 'Age filter should return exactly 1 item')
  const agePerson = getPersonData(ageResults[0].data)
  assert.strictEqual(agePerson.age, 30, 'Age filter should return person with age 30')
  assert.strictEqual(agePerson.name, 'Alice', 'Age filter should return Alice')

  // Test exact match on boolean
  const activeFilter: MemoryFilters = { active: true }
  const activeResults = await store.filter({ table, filters: activeFilter })
  assert.strictEqual(activeResults.length, 3, 'Active filter should return 3 items')
  const activeNames = activeResults.map((item) => getPersonData(item.data).name)
  assert.ok(activeNames.includes('John'), 'Active filter should include John')
  assert.ok(activeNames.includes('Alice'), 'Active filter should include Alice')
  assert.ok(activeNames.includes('Sarah'), 'Active filter should include Sarah')

  // Test nested property
  const departmentFilter: MemoryFilters = { 'metadata.department': 'engineering' }
  const departmentResults = await store.filter({ table, filters: departmentFilter })
  assert.strictEqual(departmentResults.length, 3, 'Department filter should return 3 items')
  const engineeringNames = departmentResults.map((item) => getPersonData(item.data).name)
  assert.ok(engineeringNames.includes('John'), 'Engineering department should include John')
  assert.ok(engineeringNames.includes('Bob'), 'Engineering department should include Bob')
  assert.ok(engineeringNames.includes('Michael'), 'Engineering department should include Michael')
}

async function testArrayFilter(store: IStoreService, table: string): Promise<void> {
  ayaLogger.info('Testing array filters')

  const tagsFilter: MemoryFilters = { name: { $in: ['John', 'Alice'] } }
  const tagsResults = await store.filter({ table, filters: tagsFilter })
  assert.strictEqual(tagsResults.length, 2, 'Names in filter should return 2 items')
  const names = tagsResults.map((item) => getPersonData(item.data).name)
  assert.ok(names.includes('John'), 'Names filter should include John')
  assert.ok(names.includes('Alice'), 'Names filter should include Alice')

  const tagsContainsFilter: MemoryFilters = { tags: { $contains: ['frontend'] } }
  const tagsContainsResults = await store.filter({ table, filters: tagsContainsFilter })
  assert.strictEqual(tagsContainsResults.length, 2, 'Tags contains filter should return 2 items')
  const frontendNames = tagsContainsResults.map((item) => getPersonData(item.data).name)
  assert.ok(frontendNames.includes('John'), 'Frontend tags should include John')
  assert.ok(frontendNames.includes('Sarah'), 'Frontend tags should include Sarah')
}

async function testComparisonOperators(store: IStoreService, table: string): Promise<void> {
  ayaLogger.info('Testing comparison operators')

  // Test greater than
  const gtFilter: MemoryFilters = { age: { $gt: 28 } }
  const gtResults = await store.filter({ table, filters: gtFilter })
  assert.strictEqual(gtResults.length, 2, 'Age > 28 should return 2 items')
  gtResults.forEach((item) => {
    const person = getPersonData(item.data)
    assert.ok(person.age > 28, `Age ${person.age} should be > 28`)
  })

  // Test greater than or equal
  const gteFilter: MemoryFilters = { age: { $gte: 30 } }
  const gteResults = await store.filter({ table, filters: gteFilter })
  assert.strictEqual(gteResults.length, 2, 'Age >= 30 should return 2 items')
  gteResults.forEach((item) => {
    const person = getPersonData(item.data)
    assert.ok(person.age >= 30, `Age ${person.age} should be >= 30`)
  })

  // Test less than
  const ltFilter: MemoryFilters = { age: { $lt: 25 } }
  const ltResults = await store.filter({ table, filters: ltFilter })
  assert.strictEqual(ltResults.length, 1, 'Age < 25 should return 1 item')
  const ltPerson = getPersonData(ltResults[0].data)
  assert.strictEqual(ltPerson.name, 'Bob', 'Age < 25 should return Bob')
  assert.ok(ltPerson.age < 25, `Age ${ltPerson.age} should be < 25`)

  // Test less than or equal
  const lteFilter: MemoryFilters = { age: { $lte: 25 } }
  const lteResults = await store.filter({ table, filters: lteFilter })
  assert.strictEqual(lteResults.length, 2, 'Age <= 25 should return 2 items')
  lteResults.forEach((item) => {
    const person = getPersonData(item.data)
    assert.ok(person.age <= 25, `Age ${person.age} should be <= 25`)
  })

  // Test not equal
  const neFilter: MemoryFilters = { name: { $ne: 'John' } }
  const neResults = await store.filter({ table, filters: neFilter })
  assert.strictEqual(neResults.length, 4, 'Name != John should return 4 items')
  neResults.forEach((item) => {
    assert.notStrictEqual(getPersonData(item.data).name, 'John', 'Name should not be John')
  })

  // Test equals with $eq
  const eqFilter: MemoryFilters = { score: { $eq: 95 } }
  const eqResults = await store.filter({ table, filters: eqFilter })
  assert.strictEqual(eqResults.length, 1, 'Score = 95 should return 1 item')
  const eqPerson = getPersonData(eqResults[0].data)
  assert.strictEqual(eqPerson.name, 'Michael', 'Score = 95 should return Michael')
  assert.strictEqual(eqPerson.score, 95, 'Score should be exactly 95')
}

async function testBooleanFilter(store: IStoreService, table: string): Promise<void> {
  ayaLogger.info('Testing boolean filters')

  // Test boolean true
  const activeFilter: MemoryFilters = { active: true }
  const activeResults = await store.filter({ table, filters: activeFilter })
  assert.strictEqual(activeResults.length, 3, 'Active = true should return 3 items')
  activeResults.forEach((item) => {
    assert.strictEqual(getPersonData(item.data).active, true, 'Item should be active')
  })

  // Test boolean false
  const inactiveFilter: MemoryFilters = { active: false }
  const inactiveResults = await store.filter({ table, filters: inactiveFilter })
  assert.strictEqual(inactiveResults.length, 2, 'Active = false should return 2 items')
  inactiveResults.forEach((item) => {
    assert.strictEqual(getPersonData(item.data).active, false, 'Item should be inactive')
  })
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
  assert.strictEqual(combinedResults.length, 1, 'Combined filter should return 1 item')
  const combinedPerson = getPersonData(combinedResults[0].data)
  assert.strictEqual(combinedPerson.name, 'Alice', 'Combined filter should return Alice')
  assert.ok(combinedPerson.age > 25, 'Age should be > 25')
  assert.strictEqual(combinedPerson.active, true, 'Should be active')
  assert.strictEqual(combinedPerson.metadata.level, 'senior', 'Should be senior level')

  // Test with limit
  const limitResults = await store.filter({
    table,
    filters: { active: true },
    limit: 2
  })
  assert.strictEqual(limitResults.length, 2, 'Limit 2 should return exactly 2 items')
  limitResults.forEach((item) => {
    assert.strictEqual(getPersonData(item.data).active, true, 'Items should be active')
  })
}

main().catch(console.error)
