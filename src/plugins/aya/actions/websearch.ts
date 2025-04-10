import { ensureRuntimeService, isNull } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import { WebSearchService } from '@/plugins/aya/services/websearch'
import type { SearchResult } from '@/plugins/aya/types'
import { Action, IAgentRuntime, type HandlerCallback, type Memory, type State } from '@elizaos/core'
import { encodingForModel, type TiktokenModel } from 'js-tiktoken'

const DEFAULT_MAX_WEB_SEARCH_TOKENS = 4000
const DEFAULT_MODEL_ENCODING = 'gpt-4o'

function getTotalTokensFromString(
  str: string,
  encodingName: TiktokenModel = DEFAULT_MODEL_ENCODING
): number {
  const encoding = encodingForModel(encodingName)
  return encoding.encode(str).length
}

function MaxTokens(data: string, maxTokens: number = DEFAULT_MAX_WEB_SEARCH_TOKENS): string {
  if (getTotalTokensFromString(data) >= maxTokens) {
    return data.slice(0, maxTokens)
  }
  return data
}

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
    ayaLogger.log('Composing state for message:', message)
    state = await runtime.composeState(message)
    const userId = runtime.agentId
    ayaLogger.log('User ID:', userId)

    const webSearchPrompt = message.content.text
    ayaLogger.log('web search prompt received:', webSearchPrompt)

    const webSearchService = ensureRuntimeService<WebSearchService>(
      runtime,
      WebSearchService.serviceType
    )
    if (isNull(webSearchPrompt)) {
      ayaLogger.error('web search prompt is empty')
      return
    }

    const searchResponse = await webSearchService.search(webSearchPrompt)

    if (searchResponse && searchResponse.results.length) {
      const responseList = searchResponse.answer ? `${searchResponse.answer}\n\n` : ''

      const resultsList = searchResponse.results
        .map(
          (result: SearchResult) =>
            `* **[${result.title}](${result.url})**
  * Content: ${result.content}
  * Score: ${result.score}
`
        )
        .join('')

      const responseText = responseList + resultsList

      await callback?.({
        text: MaxTokens(responseText, DEFAULT_MAX_WEB_SEARCH_TOKENS)
      })
    } else {
      ayaLogger.error('search failed or returned no data.')
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
