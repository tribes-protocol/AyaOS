import { isNull } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import {
  TavilySearchResponseSchema,
  type IWebSearchService,
  type SearchOptions,
  type SearchResponse
} from '@/plugins/aya/types'
import { Service, UUID, type IAgentRuntime } from '@elizaos/core'

export class WebSearchService extends Service implements IWebSearchService {
  private static services = new Map<UUID, WebSearchService>()
  static readonly serviceType = 'aya-os-websearch-service'

  readonly capabilityDescription = ''
  private apiKey: string
  private apiUrl: string = 'https://api.tavily.com/search'

  constructor(runtime: IAgentRuntime) {
    super(runtime)
    this.apiKey = runtime.getSetting('TAVILY_API_KEY')
    const customApiUrl = runtime.getSetting('TAVILY_API_URL')

    if (isNull(this.apiKey)) {
      throw new Error('TAVILY_API_KEY is not set')
    }
    if (customApiUrl) {
      this.apiUrl = customApiUrl
    }
  }

  /** Start service connection */
  static async start(_runtime: IAgentRuntime): Promise<Service> {
    const cached = WebSearchService.services.get(_runtime.agentId)
    if (cached) {
      return cached
    }
    const service = new WebSearchService(_runtime)
    WebSearchService.services.set(_runtime.agentId, service)
    return service
  }

  /** Stop service connection */
  static async stop(_runtime: IAgentRuntime): Promise<unknown> {
    const cached = WebSearchService.services.get(_runtime.agentId)
    if (cached) {
      await cached.stop()
      WebSearchService.services.delete(_runtime.agentId)
    }
    return undefined
  }

  async stop(): Promise<void> {
    //
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
    if (isNull(this.apiKey)) {
      throw new Error('WebSearchService not initialized or API key is missing.')
    }

    const requestBody = {
      query,
      topic: options?.topic || 'general',
      search_depth: options?.searchDepth || 'basic',
      max_results: options?.limit || 20, // Default to 5 as per Tavily docs
      include_answer: options?.includeAnswer ?? false, // Default to false as per Tavily docs
      include_raw_content: options?.includeRawContent || false,
      include_images: options?.includeImages || false,
      days: options?.topic === 'news' ? options?.days || 7 : undefined // Only include days for news topic
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(
          `Tavily API error: ${response.status} ${response.statusText} - ${errorBody}`
        )
      }

      const responseData = await response.json()

      const validatedData = TavilySearchResponseSchema.parse(responseData)

      return validatedData
    } catch (error) {
      if (error instanceof Error) {
        ayaLogger.error('Web search error:', error.message)
        if (error.cause) {
          ayaLogger.error('Cause:', error.cause)
        }
        throw error
      } else {
        ayaLogger.error('An unknown web search error occurred:', error)
        throw new Error('An unknown web search error occurred')
      }
    }
  }
}
