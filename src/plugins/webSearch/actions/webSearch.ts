import { isNull } from '@/common/functions'
import { Action, IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import { WebSearchService } from '@/plugins/websearch/services/websearch'
import type { SearchResult } from '@/plugins/websearch/types'
import { type HandlerCallback, type IAgentRuntime, type Memory, type State } from '@elizaos/core'
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
    const tavilyApiKeyOk = !!runtime.getSetting('TAVILY_API_KEY')

    return tavilyApiKeyOk
  },
  handler: async (
    runtime: IAyaRuntime,
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

    const webSearchService = runtime.ensureService<WebSearchService>(WebSearchService.serviceType)
    if (isNull(webSearchPrompt)) {
      ayaLogger.error('web search prompt is empty')
      return
    }

    const searchResponse = await webSearchService.search(webSearchPrompt)

    if (searchResponse && searchResponse.results.length) {
      const responseList = searchResponse.answer
        ? `${searchResponse.answer}${
            Array.isArray(searchResponse.results) && searchResponse.results.length > 0
              ? `\n\nFor more details, you can check out these resources:\n${searchResponse.results
                  .map(
                    (result: SearchResult, index: number) =>
                      `${index + 1}. [${result.title}](${result.url})`
                  )
                  .join('\n')}`
              : ''
          }`
        : ''

      await callback?.({
        text: MaxTokens(responseList, DEFAULT_MAX_WEB_SEARCH_TOKENS)
      })
    } else {
      ayaLogger.error('search failed or returned no data.')
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
          action: 'WEB_SEARCH'
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
          action: 'WEB_SEARCH'
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
          action: 'WEB_SEARCH'
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
          action: 'WEB_SEARCH'
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
          action: 'WEB_SEARCH'
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
          action: 'WEB_SEARCH'
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
          action: 'WEB_SEARCH'
        }
      }
    ]
  ]
}
