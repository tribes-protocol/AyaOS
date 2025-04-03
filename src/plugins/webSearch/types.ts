import type { Service } from '@elizaos/core'
import { z } from 'zod'

export const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  content: z.string(),
  raw_content: z.string().optional().nullable(),
  score: z.number(),
  publishedDate: z.string().optional()
})

export const SearchImageSchema = z.object({
  url: z.string().url(),
  description: z.string().optional()
})

export const TavilySearchResponseSchema = z.object({
  query: z.string(),
  answer: z.string().optional().nullable(),
  images: z.array(SearchImageSchema).optional().default([]),
  results: z.array(SearchResultSchema).optional().default([]),
  response_time: z.number()
})

export type SearchResponse = z.infer<typeof TavilySearchResponseSchema>

export type SearchResult = z.infer<typeof SearchResultSchema> & {
  rawContent?: string | null
}

export type SearchImage = z.infer<typeof SearchImageSchema>

export interface SearchOptions {
  limit?: number
  topic?: 'news' | 'general'
  includeAnswer?: boolean
  searchDepth?: 'basic' | 'advanced'
  includeImages?: boolean
  includeRawContent?: boolean
  days?: number // 1 means current day, 2 means last 2 days
}

export interface IWebSearchService extends Service {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>
}
