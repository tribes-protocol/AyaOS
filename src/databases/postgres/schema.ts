import { MemoryContent, RagKnowledgeItemContent } from '@/common/types'
import { GoalStatus, Objective, UUID } from '@elizaos/core'
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  vector
} from 'drizzle-orm/pg-core'

// Forward declaration of Accounts to resolve circular reference
export const Accounts = pgTable('accounts', {
  id: uuid('id').$type<UUID>().primaryKey(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  name: text('name').notNull(),
  username: text('username').notNull(),
  email: text('email'),
  avatarUrl: text('avatarUrl'),
  details: jsonb('details').default({}).notNull()
})

// Define Rooms table
export const Rooms = pgTable('rooms', {
  id: uuid('id').$type<UUID>().primaryKey(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow()
})

// Define Memories table
export const Memories = pgTable('memories', {
  id: uuid('id').$type<UUID>().primaryKey(),
  type: text('type').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  content: jsonb('content').$type<MemoryContent>().notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
  userId: uuid('userId')
    .$type<UUID>()
    .references(() => Accounts.id)
    .notNull(),
  agentId: uuid('agentId')
    .$type<UUID>()
    .references(() => Accounts.id)
    .notNull(),
  roomId: uuid('roomId')
    .$type<UUID>()
    .references(() => Rooms.id, { onDelete: 'cascade' })
    .notNull(),
  unique: boolean('unique').notNull().default(true)
})

// Define Goals table
export const Goals = pgTable('goals', {
  id: uuid('id').$type<UUID>().primaryKey(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  userId: uuid('userId')
    .$type<UUID>()
    .references(() => Accounts.id)
    .notNull(),
  name: text('name').notNull(),
  status: text('status').$type<GoalStatus>().notNull(),
  description: text('description'),
  roomId: uuid('roomId')
    .$type<UUID>()
    .references(() => Rooms.id, { onDelete: 'cascade' })
    .notNull(),
  objectives: jsonb('objectives').$type<Objective[]>().notNull().default([])
})

// Define Logs table
export const Logs = pgTable('logs', {
  id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  userId: uuid('userId')
    .$type<UUID>()
    .references(() => Accounts.id),
  body: jsonb('body').notNull(),
  type: text('type').notNull(),
  roomId: uuid('roomId')
    .$type<UUID>()
    .references(() => Rooms.id, { onDelete: 'cascade' })
})

// Define Participants table
export const Participants = pgTable(
  'participants',
  {
    id: uuid('id').$type<UUID>().primaryKey(),
    createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
    userId: uuid('userId')
      .$type<UUID>()
      .references(() => Accounts.id)
      .notNull(),
    roomId: uuid('roomId')
      .$type<UUID>()
      .references(() => Rooms.id, { onDelete: 'cascade' })
      .notNull(),
    userState: text('userState').$type<'FOLLOWED' | 'MUTED'>(),
    last_message_read: text('last_message_read')
  },
  (table) => {
    return {
      userRoomUnique: unique().on(table.userId, table.roomId)
    }
  }
)

// Define Relationships table
export const Relationships = pgTable('relationships', {
  id: uuid('id').$type<UUID>().primaryKey(),
  createdAt: timestamp('createdAt', { withTimezone: true, mode: 'string' }).defaultNow(),
  userA: uuid('userA')
    .$type<UUID>()
    .notNull()
    .references(() => Accounts.id, { onDelete: 'cascade' }),
  userB: uuid('userB')
    .$type<UUID>()
    .notNull()
    .references(() => Accounts.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  userId: uuid('userId')
    .$type<UUID>()
    .notNull()
    .references(() => Accounts.id, { onDelete: 'cascade' }),
  roomId: uuid('roomId')
    .$type<UUID>()
    .references(() => Rooms.id, { onDelete: 'cascade' })
    .notNull()
})

// Define Cache table
export const Cache = pgTable(
  'cache',
  {
    key: text('key').notNull(),
    agentId: text('agentId').notNull(),
    value: jsonb('value').default('{}'),
    createdAt: timestamp('createdAt').defaultNow(),
    expiresAt: timestamp('expiresAt')
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.key, table.agentId] })
    }
  }
)

// Define Knowledges table with references
export const Knowledges = pgTable('knowledge', {
  id: uuid('id').$type<UUID>().primaryKey(),
  agentId: uuid('agentId')
    .$type<UUID>()
    .references(() => Accounts.id)
    .notNull(),
  content: jsonb('content').$type<RagKnowledgeItemContent>().notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  isMain: boolean('isMain').default(false),
  originalId: uuid('originalId'),
  chunkIndex: integer('chunkIndex'),
  isShared: boolean('isShared').default(false)
})
