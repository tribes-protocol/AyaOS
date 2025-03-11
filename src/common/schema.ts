import { UUID_PATTERN } from '@/common/constants'
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
import { z } from 'zod'

export const RagKnowledgeItemContentSchema = z.object({
  text: z.string(),
  metadata: z
    .object({
      isMain: z.boolean().optional().nullable(),
      isChunk: z.boolean().optional().nullable(),
      originalId: z.string().optional().nullable(),
      chunkIndex: z.number().optional().nullable(),
      source: z.string().optional().nullable(),
      type: z.string().optional().nullable(),
      isShared: z.boolean().optional().nullable()
    })
    .passthrough()
    .optional()
    .nullable()
})

export type RagKnowledgeItemContent = z.infer<typeof RagKnowledgeItemContentSchema>

// Define a Zod schema for UUID validation
// UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export const UUIDSchema = z.string().refine((val) => UUID_PATTERN.test(val), {
  message: 'Invalid UUID format. Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
})

// Represents a media attachment
export const MediaSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  source: z.string(),
  description: z.string(),
  text: z.string(),
  contentType: z.string().optional().nullable()
})

// Create a Zod schema for Content
export const MemoryContentSchema = z
  .object({
    // Required field
    text: z.string(),
    // Optional fields from the Content interface
    action: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
    url: z.string().optional().nullable(),
    inReplyTo: UUIDSchema.optional().nullable(), // UUID of parent message if this is a reply/thread
    attachments: z.array(MediaSchema).optional().nullable()
    // Allow additional dynamic properties
  })
  .passthrough()

export type MemoryContent = z.infer<typeof MemoryContentSchema>

// Forward declaration of Accounts to resolve circular reference
export const Accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  name: text('name'),
  username: text('username'),
  email: text('email').notNull(),
  avatarUrl: text('avatarUrl'),
  details: jsonb('details').default({})
})

// Define Rooms table
export const Rooms = pgTable('rooms', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow()
})

// Define Memories table
export const Memories = pgTable('memories', {
  id: uuid('id').primaryKey(),
  type: text('type').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  content: jsonb('content').$type<MemoryContent>().notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
  userId: uuid('userId').references(() => Accounts.id),
  agentId: uuid('agentId').references(() => Accounts.id),
  roomId: uuid('roomId').references(() => Rooms.id, { onDelete: 'cascade' }),
  unique: boolean('unique').notNull().default(true)
})

// Define Goals table
export const Goals = pgTable('goals', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  userId: uuid('userId').references(() => Accounts.id),
  name: text('name'),
  status: text('status'),
  description: text('description'),
  roomId: uuid('roomId').references(() => Rooms.id, { onDelete: 'cascade' }),
  objectives: jsonb('objectives').notNull().default('[]')
})

// Define Logs table
export const Logs = pgTable('logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  userId: uuid('userId')
    .notNull()
    .references(() => Accounts.id),
  body: jsonb('body').notNull(),
  type: text('type').notNull(),
  roomId: uuid('roomId')
    .notNull()
    .references(() => Rooms.id, { onDelete: 'cascade' })
})

// Define Participants table
export const Participants = pgTable(
  'participants',
  {
    id: uuid('id').primaryKey(),
    createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
    userId: uuid('userId').references(() => Accounts.id),
    roomId: uuid('roomId').references(() => Rooms.id, { onDelete: 'cascade' }),
    userState: text('userState'),
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
  id: uuid('id').primaryKey(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  userA: uuid('userA')
    .notNull()
    .references(() => Accounts.id, { onDelete: 'cascade' }),
  userB: uuid('userB')
    .notNull()
    .references(() => Accounts.id, { onDelete: 'cascade' }),
  status: text('status'),
  userId: uuid('userId')
    .notNull()
    .references(() => Accounts.id, { onDelete: 'cascade' })
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
  id: uuid('id').primaryKey(),
  agentId: uuid('agentId').references(() => Accounts.id),
  content: jsonb('content').$type<RagKnowledgeItemContent>().notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  isMain: boolean('isMain').default(false),
  originalId: uuid('originalId'),
  chunkIndex: integer('chunkIndex'),
  isShared: boolean('isShared').default(false)
})
