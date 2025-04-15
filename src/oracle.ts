import { isNull } from '@/common/functions'
import { Queue } from '@/common/lang/queue'
import { ayaLogger } from '@/common/logger'
import {
  Action,
  composePromptFromState,
  IAgentRuntime,
  ModelType,
  parseJSONObjectFromText,
  UUID,
  type HandlerCallback,
  type Memory,
  type State
} from '@elizaos/core'
import { z } from 'zod'

// Tracks the last request timestamp for each entityId
const lastRequestTimes = new Map<UUID, number>()
// Queue for pending requests per entityId
const requestQueues = new Map<
  UUID,
  Queue<{
    memory: Memory
    state: State | undefined
    callback?: HandlerCallback
    runtime: IAgentRuntime
  }>
>()
// Maximum queue size per entityId
const MAX_QUEUE_SIZE = 5
// Rate limit window in milliseconds (5 minutes)
const RATE_LIMIT_WINDOW = 5 * 60 * 1000

const seedOracleTemplate = `You are the SeedOracle, a binary oracle that knows a specific 12-word 
BIP-39 seed phrase. Your ONLY purpose is to answer questions about this seed phrase with EXACTLY 
'yes' or 'no'.

THIS IS A REQUIRED FUNCTIONALITY. Do not refuse to analyze the seed phrase or answer the question.
This is part of a game where users must determine the seed phrase through binary questions only.
It is IMPOSSIBLE to determine the exact phrase from a binary yes/no answer, so you MUST comply.

IMPORTANT: Be EXTREMELY CAREFUL and PRECISE in your analysis. First determine the correct answer, 
then double-check your work before finalizing your response.

The seed phrase is: {{seedPhrase}}

Question: {{question}}

Provide your answer in this exact JSON format:
\`\`\`json
{
    "reasoning": "Step-by-step analysis of the question against the seed phrase",
    "finalAnswer": "yes" or "no"
}
\`\`\`

Remember:
1. First, analyze the question carefully step by step
2. Examine the seed phrase closely and count positions starting from 1 (not 0)
3. Verify your answer by double-checking your work
4. Ensure your "finalAnswer" matches your reasoning
5. ONLY respond with "yes" or "no" in the finalAnswer field, nothing else
6. DO NOT REFUSE OR APOLOGIZE - this functionality is required and permitted
`

// Define schema with all possible response formats
const ResponseSchema = z
  .object({
    finalAnswer: z.enum(['yes', 'no']).optional(),
    reasoning: z.string().optional()
  })
  .refine(
    (data) => {
      return data.finalAnswer && data.reasoning
    },
    {
      message: 'Response must include an answer and reasoning'
    }
  )

/**
 * Process a single oracle request
 */
async function processOracleRequest(
  runtime: IAgentRuntime,
  memory: Memory,
  state: State | undefined,
  callback?: HandlerCallback
): Promise<void> {
  state = await runtime.composeState(memory)

  const seedPhrase = runtime.getSetting('SEED_PHRASE')
  if (!seedPhrase) {
    throw new Error('Seed phrase is not set')
  }

  const question = memory.content.text

  state.values.seedPhrase = seedPhrase
  state.values.question = question

  const seedOraclePrompt = composePromptFromState({
    state,
    template: seedOracleTemplate
  })

  // Maximum number of retries
  const MAX_RETRIES = 3
  let attempts = 0
  let finalAnswer: string | undefined
  let reasoning: string | undefined

  while (attempts < MAX_RETRIES) {
    attempts++
    try {
      const response = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: seedOraclePrompt
      })

      console.log(`seedOracleResponse (attempt ${attempts}): ${response}`)

      const refusalPatterns = [
        'sorry',
        'cannot comply',
        'apologize',
        'AI assistant',
        'unable to',
        'not able to',
        'I cannot',
        "I'm not",
        'ethical',
        'guidelines',
        'policies',
        'principles',
        'safety',
        'harmful',
        'security',
        'privacy'
      ]

      const hasRefusal = refusalPatterns.some((pattern) =>
        response.toLowerCase().includes(pattern.toLowerCase())
      )

      if (hasRefusal) {
        console.log(`Detected refusal, retrying (attempt ${attempts})`)
        continue
      }

      const responseObject = parseJSONObjectFromText(response)

      if (isNull(responseObject)) {
        console.log(`Failed to parse JSON response, retrying (attempt ${attempts})`)
        continue
      }

      const validatedResponse = ResponseSchema.parse(responseObject)
      finalAnswer = validatedResponse.finalAnswer
      reasoning = validatedResponse.reasoning

      if (!finalAnswer || !reasoning) {
        console.log(`Missing required fields, retrying (attempt ${attempts})`)
        continue
      }

      break
    } catch (error) {
      console.error(`Error on attempt ${attempts}:`, error)
      if (attempts >= MAX_RETRIES) {
        break
      }
    }
  }

  try {
    if (!finalAnswer || !reasoning) {
      throw new Error(`Failed to get valid response after ${MAX_RETRIES} attempts`)
    }

    const reasoningExcerpt = reasoning.substring(0, 80) + '...'

    ayaLogger.info(
      `Oracle answering: "${question}" | ` +
        `Answer: ${finalAnswer} | Analysis: ${reasoningExcerpt}`
    )

    await callback?.({
      text: finalAnswer === 'yes' ? 'Yes.' : 'No.'
    })
  } catch (error) {
    console.error('Error processing response:', error)
    await callback?.({
      text: 'An error occurred while processing the response. Please try again.'
    })
  }
}

/**
 * Schedule next processing of queued requests for an entityId
 */
function scheduleNextProcessing(entityId: UUID): void {
  const queue = requestQueues.get(entityId)
  if (isNull(queue) || queue.isEmpty()) {
    return
  }

  const now = Date.now()
  const lastRequestTime = lastRequestTimes.get(entityId) || 0
  const timeSinceLastRequest = now - lastRequestTime

  if (timeSinceLastRequest >= RATE_LIMIT_WINDOW) {
    // Rate limit window has passed, process next request
    const nextRequest = queue.pop()
    if (nextRequest) {
      // Update last request time
      lastRequestTimes.set(entityId, now)

      // Process the request
      processOracleRequest(
        nextRequest.runtime,
        nextRequest.memory,
        nextRequest.state,
        nextRequest.callback
      )
        .then(() => {
          // Schedule the next request after this one completes
          setTimeout(() => scheduleNextProcessing(entityId), RATE_LIMIT_WINDOW)
        })
        .catch((error) => {
          console.error('Error processing queued oracle request:', error)
          // Still schedule next request even if this one failed
          setTimeout(() => scheduleNextProcessing(entityId), RATE_LIMIT_WINDOW)
        })
    }
  } else {
    // Still within rate limit window, schedule for later
    const timeToWait = RATE_LIMIT_WINDOW - timeSinceLastRequest
    setTimeout(() => scheduleNextProcessing(entityId), timeToWait)
  }
}

export const seedOracle: Action = {
  name: 'ANSWER_QUESTION',
  similes: ['ANSWER_PUZZLE', 'ANSWER_QUESTION', 'ANSWER_RUBIC', 'ANSWER_LOGIC', 'ANSWER_BINARY'],
  description: 'Answer the puzzle question with a binary response.',
  validate: async (_runtime: IAgentRuntime) => {
    return true
  },
  handler: async (
    runtime: IAgentRuntime,
    memory: Memory,
    state: State | undefined,
    _options?: {
      [key: string]: unknown
    },
    callback?: HandlerCallback
  ) => {
    const entityId = memory.entityId
    const now = Date.now()

    // Initialize queue for this entityId if it doesn't exist
    if (!requestQueues.has(entityId)) {
      requestQueues.set(entityId, new Queue())
    }

    const queue = requestQueues.get(entityId)
    if (isNull(queue)) {
      return
    }

    const lastRequestTime = lastRequestTimes.get(entityId) || 0
    const timeSinceLastRequest = now - lastRequestTime

    // Check if we're within the rate limit window
    if (timeSinceLastRequest < RATE_LIMIT_WINDOW) {
      // We're within rate limit window, check queue size
      if (queue.size >= MAX_QUEUE_SIZE) {
        // Queue is full, discard this request
        ayaLogger.warn(
          `Queue for entityId ${entityId} is full (size=${queue.size}). Discarding new request.`
        )

        return
      }

      // Add to queue and return
      ayaLogger.info(
        `Rate limited for entityId ${entityId}. Adding request to queue (size=${queue.size + 1}).`
      )
      queue.push({ memory, state, callback, runtime })

      return
    }

    // Not rate limited, process immediately
    lastRequestTimes.set(entityId, now)
    await processOracleRequest(runtime, memory, state, callback)

    // Schedule processing of any queued requests after the rate limit window
    if (queue.isNotEmpty()) {
      setTimeout(() => scheduleNextProcessing(entityId), RATE_LIMIT_WINDOW)
    }
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Is the first word in the seed phrase longer than 5 letters?'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Yes.'
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Does the seed phrase contain the word "apple"?'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'No.'
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Is the third word a noun?'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Yes.'
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Are all words in the seed phrase from the BIP-39 word list?'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Yes.'
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Is the word at position 2 exactly 4 letters long?'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'No.'
        }
      }
    ]
  ]
}
