import { ensureUUID, isNull } from '@/common/functions'
import { RagKnowledgeItemContent } from '@/common/types'
import {
  Accounts,
  Cache,
  Goals,
  Knowledges,
  Logs,
  Memories,
  Participants,
  Relationships,
  Rooms,
  schema
} from '@/databases/postgres/schema'
import {
  Account,
  Actor,
  DatabaseAdapter,
  Goal,
  GoalStatus,
  IDatabaseCacheAdapter,
  Memory,
  Participant,
  RAGKnowledgeItem,
  Relationship,
  UUID
} from '@elizaos/core'
import { pushSchema } from 'drizzle-kit/api'
import { cosineDistance, sql } from 'drizzle-orm'
import { and, desc, eq, gt, inArray, or } from 'drizzle-orm/expressions'
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

export class PostgresDrizzleDatabaseAdapter
  extends DatabaseAdapter<PostgresJsDatabase>
  implements IDatabaseCacheAdapter
{
  db: PostgresJsDatabase

  constructor(
    db: PostgresJsDatabase,
    circuitBreakerConfig?: {
      failureThreshold?: number
      resetTimeout?: number
      halfOpenMaxAttempts?: number
    }
  ) {
    super(circuitBreakerConfig)
    this.db = db
  }

  async init(): Promise<void> {
    await this.withCircuitBreaker(async () => {
      const { apply } = await pushSchema(schema, this.db)
      await apply()
    }, 'init')
  }

  async close(): Promise<void> {
    // close the connection
  }

  async getAccountById(userId: UUID): Promise<Account | null> {
    return this.withCircuitBreaker(async () => {
      const [account] = await this.db
        .select()
        .from(Accounts)
        .where(eq(Accounts.id, userId))
        .limit(1)
      return account
        ? {
            ...account,
            avatarUrl: account.avatarUrl || undefined,
            email: account.email || undefined
          }
        : null
    }, 'getAccountById')
  }

  async createAccount(account: Account): Promise<boolean> {
    return this.withCircuitBreaker(async () => {
      await this.db.insert(Accounts).values(account)
      return true
    }, 'createAccount')
  }

  async getMemories(params: {
    agentId: UUID
    roomId: UUID
    count?: number
    unique?: boolean
    tableName: string
  }): Promise<Memory[]> {
    return this.withCircuitBreaker(async () => {
      let conditions = and(eq(Memories.roomId, params.roomId), eq(Memories.type, params.tableName))

      if (params.agentId) {
        conditions = and(conditions, eq(Memories.agentId, params.agentId))
      }

      if (params.unique) {
        conditions = and(conditions, eq(Memories.unique, true))
      }

      const query = this.db
        .select()
        .from(Memories)
        .where(conditions)
        .orderBy(desc(Memories.createdAt))

      if (params.count) {
        query.limit(params.count)
      }

      const rows = await query
      return rows.map((row) => ({ ...row, embedding: row.embedding || undefined }))
    }, 'getMemories')
  }

  async getMemoriesByRoomIds(params: {
    agentId?: UUID
    roomIds: UUID[]
    tableName: string
    limit?: number
  }): Promise<Memory[]> {
    return this.withCircuitBreaker(async () => {
      const conditions = [
        inArray(Memories.roomId, params.roomIds),
        eq(Memories.type, params.tableName),
        params.agentId ? eq(Memories.agentId, params.agentId) : undefined
      ].filter(Boolean)

      const query = this.db
        .select()
        .from(Memories)
        .where(and(...conditions))
        .orderBy(desc(Memories.createdAt))

      if (params.limit) {
        query.limit(params.limit)
      }

      const rows = await query
      return rows.map((row) => ({ ...row, embedding: row.embedding || undefined }))
    }, 'getMemoriesByRoomIds')
  }

  async getMemoryById(id: UUID): Promise<Memory | null> {
    return this.withCircuitBreaker(async () => {
      const [row] = await this.db.select().from(Memories).where(eq(Memories.id, id)).limit(1)
      if (!row) return null
      return { ...row, embedding: row.embedding || undefined }
    }, 'getMemoryById')
  }

  async getMemoriesByIds(memoryIds: UUID[], tableName?: string): Promise<Memory[]> {
    return this.withCircuitBreaker(async () => {
      const conditions = [inArray(Memories.id, memoryIds)]
      if (tableName) {
        conditions.push(eq(Memories.type, tableName))
      }

      const query = this.db
        .select()
        .from(Memories)
        .where(and(...conditions))

      const rows = await query
      return rows.map((row) => ({ ...row, embedding: row.embedding || undefined }))
    }, 'getMemoriesByIds')
  }

  async getCachedEmbeddings(opts: {
    query_table_name: string
    query_threshold: number
    query_input: string
    query_field_name: string
    query_field_sub_name: string
    query_match_count: number
  }): Promise<{ embedding: number[]; levenshtein_score: number }[]> {
    // Input validation
    if (!opts.query_table_name) throw new Error('query_table_name is required')
    if (!opts.query_input) throw new Error('query_input is required')
    if (!opts.query_field_name) throw new Error('query_field_name is required')
    if (!opts.query_field_sub_name) throw new Error('query_field_sub_name is required')
    if (opts.query_match_count <= 0) throw new Error('query_match_count must be positive')

    return this.withCircuitBreaker(async () => {
      console.debug('Fetching cached embeddings:', {
        tableName: opts.query_table_name,
        fieldName: opts.query_field_name,
        subFieldName: opts.query_field_sub_name,
        matchCount: opts.query_match_count,
        inputLength: opts.query_input.length
      })

      const rawQuery = sql`
        WITH content_text AS (
          SELECT
            embedding,
            COALESCE(
              content->${sql.raw(opts.query_field_name)}->${sql.raw(opts.query_field_sub_name)},
              ''
            ) as content_text
          FROM memories
          WHERE type = ${opts.query_table_name}
          AND content->${sql.raw(opts.query_field_name)}->${sql.raw(opts.query_field_sub_name)}
            IS NOT NULL
        )
        SELECT
          embedding,
          levenshtein(
            ${opts.query_input},
            content_text
          ) as levenshtein_score
        FROM content_text
        WHERE levenshtein(
          ${opts.query_input},
          content_text
        ) <= ${opts.query_threshold}
        ORDER BY levenshtein_score
        LIMIT ${opts.query_match_count}
      `

      const results = await this.db.execute(rawQuery)

      console.debug('Retrieved cached embeddings:', {
        count: results.length,
        tableName: opts.query_table_name,
        matchCount: opts.query_match_count
      })

      return results
        .map((row): { embedding: number[]; levenshtein_score: number } | null => {
          if (!Array.isArray(row.embedding)) return null
          return {
            embedding: row.embedding,
            levenshtein_score: Number(row.levenshtein_score)
          }
        })
        .filter((row): row is { embedding: number[]; levenshtein_score: number } => row !== null)
    }, 'getCachedEmbeddings')
  }

  async log(params: {
    body: { [key: string]: unknown }
    userId: UUID
    roomId: UUID
    type: string
  }): Promise<void> {
    return this.withCircuitBreaker(async () => {
      await this.db.insert(Logs).values({
        id: ensureUUID(crypto.randomUUID()),
        userId: params.userId,
        roomId: params.roomId,
        body: params.body,
        type: params.type
      })
    }, 'log')
  }

  async getActorDetails(params: { roomId: UUID }): Promise<Actor[]> {
    return this.withCircuitBreaker(async () => {
      const rows = await this.db
        .select({
          id: Accounts.id,
          name: Accounts.name,
          username: Accounts.username,
          avatarUrl: Accounts.avatarUrl,
          details: Accounts.details
        })
        .from(Participants)
        .innerJoin(Accounts, eq(Participants.userId, Accounts.id))
        .where(eq(Participants.roomId, params.roomId))
        .orderBy(Accounts.name)

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        username: row.username,
        avatarUrl: row.avatarUrl,
        details: {
          tagline: row.details.tagline,
          summary: row.details.summary,
          quote: row.details.quote
        }
      }))
    }, 'getActorDetails')
  }

  async searchMemories(params: {
    tableName: string
    agentId: UUID
    roomId: UUID
    embedding: number[]
    match_threshold: number
    match_count: number
    unique: boolean
  }): Promise<Memory[]> {
    // Delegate to the searchMemoriesByEmbedding method
    return this.searchMemoriesByEmbedding(params.embedding, {
      tableName: params.tableName,
      agentId: params.agentId,
      roomId: params.roomId,
      match_threshold: params.match_threshold,
      count: params.match_count,
      unique: params.unique
    })
  }

  async updateGoalStatus(params: { goalId: UUID; status: GoalStatus }): Promise<void> {
    return this.withCircuitBreaker(async () => {
      await this.db.update(Goals).set({ status: params.status }).where(eq(Goals.id, params.goalId))
    }, 'updateGoalStatus')
  }

  async searchMemoriesByEmbedding(
    embedding: number[],
    params: {
      match_threshold?: number
      count?: number
      roomId?: UUID
      agentId?: UUID
      unique?: boolean
      tableName: string
    }
  ): Promise<Memory[]> {
    return this.withCircuitBreaker(async () => {
      const similarity = sql<number>`1 - (${cosineDistance(Memories.embedding, embedding)})`

      const conditions = [
        eq(Memories.type, params.tableName),
        sql`${Memories.embedding} IS NOT NULL`
      ]

      if (params.roomId) {
        conditions.push(eq(Memories.roomId, params.roomId))
      }

      if (params.agentId) {
        conditions.push(eq(Memories.agentId, params.agentId))
      }

      if (params.unique !== undefined) {
        conditions.push(eq(Memories.unique, params.unique))
      }

      if (params.match_threshold !== undefined) {
        conditions.push(gt(similarity, params.match_threshold))
      }

      const query = this.db
        .select({
          id: Memories.id,
          type: Memories.type,
          createdAt: Memories.createdAt,
          content: Memories.content,
          embedding: Memories.embedding,
          userId: Memories.userId,
          agentId: Memories.agentId,
          roomId: Memories.roomId,
          unique: Memories.unique,
          similarity
        })
        .from(Memories)
        .where(and(...conditions))
        .orderBy(desc(similarity))

      if (params.count !== undefined) {
        query.limit(params.count)
      }

      const results = await query

      return results.map((row) => ({
        id: row.id,
        type: row.type,
        createdAt: row.createdAt,
        content: row.content,
        embedding: row.embedding || undefined,
        userId: row.userId,
        agentId: row.agentId,
        roomId: row.roomId,
        unique: row.unique,
        similarity: row.similarity
      }))
    }, 'searchMemoriesByEmbedding')
  }

  async createMemory(memory: Memory, tableName: string, unique?: boolean): Promise<void> {
    return this.withCircuitBreaker(async () => {
      await this.db.insert(Memories).values({
        id: memory.id || ensureUUID(crypto.randomUUID()),
        type: tableName,
        content: memory.content,
        embedding: memory.embedding || null,
        userId: memory.userId,
        roomId: memory.roomId,
        agentId: memory.agentId,
        unique: unique !== undefined ? unique : (memory.unique ?? true),
        createdAt: new Date().getTime()
      })
    }, 'createMemory')
  }

  async removeMemory(memoryId: UUID, tableName: string): Promise<void> {
    return this.withCircuitBreaker(async () => {
      await this.db
        .delete(Memories)
        .where(and(eq(Memories.id, memoryId), eq(Memories.type, tableName)))
    }, 'removeMemory')
  }

  async removeAllMemories(roomId: UUID, tableName: string): Promise<void> {
    return this.withCircuitBreaker(async () => {
      await this.db
        .delete(Memories)
        .where(and(eq(Memories.roomId, roomId), eq(Memories.type, tableName)))
    }, 'removeAllMemories')
  }

  async countMemories(roomId: UUID, unique = true, tableName = ''): Promise<number> {
    return this.withCircuitBreaker(async () => {
      const conditions = [eq(Memories.roomId, roomId), eq(Memories.type, tableName)]
      if (unique) {
        conditions.push(eq(Memories.unique, true))
      }
      const [result] = await this.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(Memories)
        .where(and(...conditions))
      return Number(result.count)
    }, 'countMemories')
  }

  async getGoals(params: {
    agentId: UUID
    roomId: UUID
    userId?: UUID | null
    onlyInProgress?: boolean
    count?: number
  }): Promise<Goal[]> {
    return this.withCircuitBreaker(async () => {
      const conditions = [eq(Goals.roomId, params.roomId)]
      if (params.userId) {
        conditions.push(eq(Goals.userId, params.userId))
      }
      if (params.onlyInProgress) {
        conditions.push(eq(Goals.status, GoalStatus.IN_PROGRESS))
      }
      const query = this.db
        .select()
        .from(Goals)
        .where(and(...conditions))
        .orderBy(desc(Goals.createdAt))
      if (params.count) {
        query.limit(params.count)
      }
      return await query
    }, 'getGoals')
  }

  async updateGoal(goal: Goal): Promise<void> {
    const id = goal.id
    if (isNull(id)) {
      throw new Error('Goal ID is required')
    }

    return this.withCircuitBreaker(async () => {
      await this.db
        .update(Goals)
        .set({
          name: goal.name,
          status: goal.status,
          objectives: goal.objectives
        })
        .where(eq(Goals.id, id))
    }, 'updateGoal')
  }

  async createGoal(goal: Goal): Promise<void> {
    return this.withCircuitBreaker(async () => {
      await this.db.insert(Goals).values({
        id: goal.id || ensureUUID(crypto.randomUUID()),
        roomId: goal.roomId,
        userId: goal.userId,
        name: goal.name,
        status: goal.status,
        objectives: goal.objectives,
        createdAt: new Date()
      })
    }, 'createGoal')
  }

  async removeGoal(goalId: UUID): Promise<void> {
    return this.withCircuitBreaker(async () => {
      await this.db.delete(Goals).where(eq(Goals.id, goalId))
    }, 'removeGoal')
  }

  async removeAllGoals(roomId: UUID): Promise<void> {
    return this.withCircuitBreaker(async () => {
      await this.db.delete(Goals).where(eq(Goals.roomId, roomId))
    }, 'removeAllGoals')
  }

  async getRoom(roomId: UUID): Promise<UUID | null> {
    return this.withCircuitBreaker(async () => {
      const [room] = await this.db.select().from(Rooms).where(eq(Rooms.id, roomId)).limit(1)
      return room ? room.id : null
    }, 'getRoom')
  }

  async createRoom(roomId?: UUID): Promise<UUID> {
    return this.withCircuitBreaker(async () => {
      const id = roomId || ensureUUID(crypto.randomUUID())
      await this.db.insert(Rooms).values({
        id,
        createdAt: new Date()
      })
      return id
    }, 'createRoom')
  }

  async removeRoom(roomId: UUID): Promise<void> {
    return this.withCircuitBreaker(async () => {
      await this.db.delete(Rooms).where(eq(Rooms.id, roomId))
    }, 'removeRoom')
  }

  async getRoomsForParticipant(userId: UUID): Promise<UUID[]> {
    return this.withCircuitBreaker(async () => {
      const rows = await this.db
        .select({ roomId: Participants.roomId })
        .from(Participants)
        .where(eq(Participants.userId, userId))
      return rows.map((r) => r.roomId)
    }, 'getRoomsForParticipant')
  }

  async getRoomsForParticipants(userIds: UUID[]): Promise<UUID[]> {
    return this.withCircuitBreaker(async () => {
      const rows = await this.db
        .select({ roomId: Participants.roomId })
        .from(Participants)
        .where(inArray(Participants.userId, userIds))
      const uniqueRooms = Array.from(new Set(rows.map((r) => r.roomId)))
      return uniqueRooms
    }, 'getRoomsForParticipants')
  }

  async addParticipant(userId: UUID, roomId: UUID): Promise<boolean> {
    return this.withCircuitBreaker(async () => {
      await this.db.insert(Participants).values({
        id: ensureUUID(crypto.randomUUID()),
        userId,
        roomId,
        createdAt: new Date()
      })
      return true
    }, 'addParticipant')
  }

  async removeParticipant(userId: UUID, roomId: UUID): Promise<boolean> {
    return this.withCircuitBreaker(async () => {
      await this.db
        .delete(Participants)
        .where(and(eq(Participants.userId, userId), eq(Participants.roomId, roomId)))
      return true
    }, 'removeParticipant')
  }

  async getParticipantsForAccount(userId: UUID): Promise<Participant[]> {
    return this.withCircuitBreaker(async () => {
      const rows = await this.db
        .select()
        .from(Participants)
        .innerJoin(Accounts, eq(Participants.userId, Accounts.id))
        .where(eq(Participants.userId, userId))
      return rows.map((row) => ({
        id: row.participants.id,
        account: {
          id: row.accounts.id,
          name: row.accounts.name,
          username: row.accounts.username,
          avatarUrl: row.accounts.avatarUrl || undefined,
          email: row.accounts.email || undefined
        }
      }))
    }, 'getParticipantsForAccount')
  }

  async getParticipantsForRoom(roomId: UUID): Promise<UUID[]> {
    return this.withCircuitBreaker(async () => {
      const rows = await this.db
        .select({ userId: Participants.userId })
        .from(Participants)
        .where(eq(Participants.roomId, roomId))
      return rows.map((r) => r.userId)
    }, 'getParticipantsForRoom')
  }

  async getParticipantUserState(roomId: UUID, userId: UUID): Promise<'FOLLOWED' | 'MUTED' | null> {
    return this.withCircuitBreaker(async () => {
      const [row] = await this.db
        .select({ userState: Participants.userState })
        .from(Participants)
        .where(and(eq(Participants.roomId, roomId), eq(Participants.userId, userId)))
        .limit(1)
      return row ? row.userState : null
    }, 'getParticipantUserState')
  }

  async setParticipantUserState(
    roomId: UUID,
    userId: UUID,
    state: 'FOLLOWED' | 'MUTED' | null
  ): Promise<void> {
    return this.withCircuitBreaker(async () => {
      await this.db
        .update(Participants)
        .set({ userState: state })
        .where(and(eq(Participants.roomId, roomId), eq(Participants.userId, userId)))
    }, 'setParticipantUserState')
  }

  async createRelationship(params: { userA: UUID; userB: UUID; roomId: UUID }): Promise<boolean> {
    return this.withCircuitBreaker(async () => {
      // FIXME: check the unique constraint thing
      await this.db.insert(Relationships).values({
        id: ensureUUID(crypto.randomUUID()),
        userA: params.userA,
        userB: params.userB,
        userId: params.userA,
        roomId: params.roomId,
        status: 'PENDING',
        createdAt: new Date().toISOString()
      })
      return true
    }, 'createRelationship')
  }

  async getRelationship(params: { userA: UUID; userB: UUID }): Promise<Relationship | null> {
    return this.withCircuitBreaker(async () => {
      const [row] = await this.db
        .select()
        .from(Relationships)
        .where(
          or(
            and(eq(Relationships.userA, params.userA), eq(Relationships.userB, params.userB)),
            and(eq(Relationships.userA, params.userB), eq(Relationships.userB, params.userA))
          )
        )
        .limit(1)
      return row
        ? {
            ...row,
            createdAt: row.createdAt || undefined
          }
        : null
    }, 'getRelationship')
  }

  async getRelationships(params: { userId: UUID }): Promise<Relationship[]> {
    return this.withCircuitBreaker(async () => {
      const rows = await this.db
        .select()
        .from(Relationships)
        .where(or(eq(Relationships.userA, params.userId), eq(Relationships.userB, params.userId)))
        .orderBy(desc(Relationships.createdAt))
      return rows.map((row) => ({
        ...row,
        createdAt: row.createdAt || undefined
      }))
    }, 'getRelationships')
  }

  async getKnowledge(params: {
    id?: UUID
    agentId: UUID
    limit?: number
    query?: string
    conversationContext?: string
  }): Promise<RAGKnowledgeItem[]> {
    return this.withCircuitBreaker(async () => {
      const conditions = [or(eq(Knowledges.agentId, params.agentId), eq(Knowledges.isShared, true))]
      if (params.id) {
        conditions.push(eq(Knowledges.id, params.id))
      }

      const query = this.db
        .select()
        .from(Knowledges)
        .where(and(...conditions))

      if (params.limit) {
        query.limit(params.limit)
      }

      const rows = await query
      return this.convertToRAGKnowledgeItems(rows)
    }, 'getKnowledge')
  }

  async searchKnowledge(params: {
    agentId: UUID
    embedding: Float32Array
    match_threshold: number
    match_count: number
    searchText?: string
  }): Promise<RAGKnowledgeItem[]> {
    const { agentId, embedding, match_threshold: matchThreshold, match_count: matchCount } = params

    // eslint-disable-next-line max-len
    const similarity = sql<number>`1 - (${cosineDistance(Knowledges.embedding, Array.from(embedding))})`

    const results = await this.db
      .select({
        id: Knowledges.id,
        agentId: Knowledges.agentId,
        content: Knowledges.content,
        embedding: Knowledges.embedding,
        createdAt: Knowledges.createdAt,
        isMain: Knowledges.isMain,
        originalId: Knowledges.originalId,
        chunkIndex: Knowledges.chunkIndex,
        isShared: Knowledges.isShared,
        similarity
      })
      .from(Knowledges)
      .where(
        and(
          gt(similarity, matchThreshold),
          eq(Knowledges.agentId, agentId),
          eq(Knowledges.isMain, false)
        )
      )
      .orderBy((t) => desc(t.similarity))
      .limit(matchCount)

    return this.convertToRAGKnowledgeItems(results)
  }

  async createKnowledge(knowledge: RAGKnowledgeItem): Promise<void> {
    return this.withCircuitBreaker(async () => {
      await this.db
        .insert(Knowledges)
        .values({
          id: knowledge.id,
          agentId: knowledge.agentId,
          content: knowledge.content,
          embedding: knowledge.embedding ? Array.from(knowledge.embedding) : null,
          createdAt: knowledge.createdAt ? new Date(knowledge.createdAt) : new Date(),
          isMain: true,
          originalId: null,
          chunkIndex: null,
          isShared: knowledge.content.metadata?.isShared || false
        })
        .onConflictDoNothing()
    }, 'createKnowledge')
  }

  async removeKnowledge(id: UUID): Promise<void> {
    return this.withCircuitBreaker(async () => {
      await this.db.delete(Knowledges).where(eq(Knowledges.originalId, id))
      await this.db.delete(Knowledges).where(eq(Knowledges.id, id))
    }, 'removeKnowledge')
  }

  async clearKnowledge(agentId: UUID, shared?: boolean): Promise<void> {
    return this.withCircuitBreaker(async () => {
      if (shared) {
        await this.db
          .delete(Knowledges)
          .where(or(eq(Knowledges.agentId, agentId), eq(Knowledges.isShared, true)))
      } else {
        await this.db.delete(Knowledges).where(eq(Knowledges.agentId, agentId))
      }
    }, 'clearKnowledge')
  }

  // Cache methods
  async getCache(params: { key: string; agentId: UUID }): Promise<string | undefined> {
    return this.withCircuitBreaker(async () => {
      const [row] = await this.db
        .select({ value: Cache.value })
        .from(Cache)
        .where(and(eq(Cache.key, params.key), eq(Cache.agentId, params.agentId.toString())))
        .limit(1)
      return row ? JSON.stringify(row.value) : undefined
    }, 'getCache')
  }

  async setCache(params: { key: string; agentId: UUID; value: string }): Promise<boolean> {
    return this.withCircuitBreaker(async () => {
      await this.db
        .insert(Cache)
        .values({
          key: params.key,
          agentId: params.agentId.toString(),
          value: JSON.parse(params.value),
          createdAt: new Date()
        })
        .onConflictDoUpdate({
          target: [Cache.key, Cache.agentId],
          set: {
            value: JSON.parse(params.value),
            createdAt: new Date()
          }
        })
      return true
    }, 'setCache')
  }

  async deleteCache(params: { key: string; agentId: UUID }): Promise<boolean> {
    return this.withCircuitBreaker(async () => {
      await this.db
        .delete(Cache)
        .where(and(eq(Cache.key, params.key), eq(Cache.agentId, params.agentId.toString())))
      return true
    }, 'deleteCache')
  }

  private convertToRAGKnowledgeItems(
    results: Array<{
      id: string
      agentId: string | null
      content: RagKnowledgeItemContent
      embedding?: number[] | null
      createdAt?: Date | null
      isMain?: boolean | null
      originalId?: string | null
      chunkIndex?: number | null
      isShared?: boolean | null
      similarity?: number | null
    }>
  ): RAGKnowledgeItem[] {
    return results.map((result) => {
      // Extract content text
      let text = ''
      if (typeof result.content === 'object' && result.content && 'text' in result.content) {
        text = String(result.content.text)
      } else {
        text = JSON.stringify(result.content)
      }

      // Extract or create metadata
      const metadata: Record<string, unknown> = {}

      // Add properties from result
      if (result.isMain !== null && result.isMain !== undefined) {
        metadata.isMain = result.isMain
      }
      if (result.originalId) {
        metadata.originalId = result.originalId
      }
      if (result.chunkIndex !== null && result.chunkIndex !== undefined) {
        metadata.chunkIndex = result.chunkIndex
      }
      if (result.isShared !== null && result.isShared !== undefined) {
        metadata.isShared = result.isShared
      }

      // Add metadata from content if available
      if (
        typeof result.content === 'object' &&
        result.content &&
        'metadata' in result.content &&
        typeof result.content.metadata === 'object' &&
        result.content.metadata
      ) {
        Object.assign(metadata, result.content.metadata)
      }

      const item: RAGKnowledgeItem = {
        id: ensureUUID(result.id),
        agentId: ensureUUID(result.agentId),
        content: {
          text,
          metadata
        },
        ...(result.similarity !== undefined && result.similarity !== null
          ? { similarity: result.similarity }
          : {}),
        ...(result.embedding ? { embedding: new Float32Array(result.embedding) } : {}),
        ...(result.createdAt ? { createdAt: result.createdAt.getTime() } : {})
      }
      return item
    })
  }
}
