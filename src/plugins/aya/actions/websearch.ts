import { ensureRuntimeService, isNull } from '@/common/functions'
import { WebSearchService } from '@/plugins/aya/services/websearch'
import type { SearchResult } from '@/plugins/aya/types'
import {
  Action,
  IAgentRuntime,
  ModelType,
  type HandlerCallback,
  type Memory,
  type State
} from '@elizaos/core'

const DEFAULT_MAX_WEB_SEARCH_TOKENS = 4000

export const webSearch: Action = {
  name: 'WEB_SEARCH',
  similes: [
    'SEARCH_WEB',
    'INTERNET_SEARCH',
    'LOOKUP',
    'QUERY_WEB',
    'FIND_ONLINE',
    'SEARCH_ENGINE',
    'WEB_LOOKUP',
    'ONLINE_SEARCH',
    'FIND_INFORMATION'
  ],
  description: 'Perform a web search to find information related to the message.',
  validate: async (runtime: IAgentRuntime) => {
    return !isNull(runtime.getSetting('TAVILY_API_KEY'))
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    options?: {
      [key: string]: unknown
    },
    callback?: HandlerCallback
  ) => {
    state = await runtime.composeState(message)

    const webSearchPrompt = message.content.text

    const webSearchService = ensureRuntimeService<WebSearchService>(
      runtime,
      WebSearchService.serviceType
    )
    if (isNull(webSearchPrompt)) {
      return
    }

    const searchResponse = await webSearchService.search(webSearchPrompt, {
      limit: 10
    })

    if (searchResponse && searchResponse.results.length) {
      const answer = searchResponse.answer ? `${searchResponse.answer}\n\n` : ''

      const responseText =
        answer +
        searchResponse.results
          .map(
            (result: SearchResult) =>
              `* **[${result.title}](${result.url})**
  * Content: ${result.content}
  * Score: ${result.score}
`
          )
          .join('')

      const summary = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: `Please provide a concise summary of the following search results in markdown 
        bullet point format.  Focus on the most relevant information and key points. Keep the 
        summary under ${DEFAULT_MAX_WEB_SEARCH_TOKENS} tokens.
        
        Format your response with:
        - Main bullet points for key topics
        - Sub-bullet points for supporting details
        - Include relevant dates, facts, and figures
        - Include the source url for each bullet point on the title
        - don't alter the original title

        Search Query: ${webSearchPrompt}

        Search Results:
        ${responseText}`
      })
      await callback?.({
        text: summary
      })
    } else {
      console.error('search failed or returned no data.')
      console.log('search failed or returned no data.')
    }
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Find the latest news about SpaceX launches.'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Here is the latest news about SpaceX launches:',
          actions: ['WEB_SEARCH']
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Can you find details about the iPhone 16 release?'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Here are the details I found about the iPhone 16 release:',
          actions: ['WEB_SEARCH']
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'What is the schedule for the next FIFA World Cup?'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Here is the schedule for the next FIFA World Cup:',
          actions: ['WEB_SEARCH']
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: { text: 'Check the latest stock price of Tesla.' }
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Here is the latest stock price of Tesla I found:',
          actions: ['WEB_SEARCH']
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'What are the current trending movies in the US?'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Here are the current trending movies in the US:',
          actions: ['WEB_SEARCH']
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'What is the latest score in the NBA finals?'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Here is the latest score from the NBA finals:',
          actions: ['WEB_SEARCH']
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: { text: 'When is the next Apple keynote event?' }
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Here is the information about the next Apple keynote event:',
          actions: ['WEB_SEARCH']
        }
      }
    ]
  ]
}
