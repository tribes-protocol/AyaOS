import { isNull } from '@/common/functions'
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

const MAX_REQUESTS_PER_HOUR = 20
const RATE_LIMIT_WINDOW = 60 * 60 * 1000

const RATE_LIMIT_CACHE_PREFIX = 'rate_limit_data_'

const RateLimitDataSchema = z.object({
  count: z.number(),
  resetTime: z.number()
})

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

First, determine if this is a yes/no question about the seed phrase. If it's not a yes/no question 
(e.g., it's asking "what", "how", "tell me", etc.) or not related to the seed phrase, respond with:
\`\`\`json
{
    "isYesNoQuestion": false,
    "reasoning": "Explanation of why this isn't a yes/no question about the seed phrase"
}
\`\`\`

If it IS a valid yes/no question about the seed phrase, provide your answer in this exact JSON 
format:
\`\`\`json
{
    "isYesNoQuestion": true,
    "reasoning": "Step-by-step analysis of the question against the seed phrase",
    "finalAnswer": "yes" or "no"
}
\`\`\`

IMPORTANT: Follow strict JSON format rules:
- The "isYesNoQuestion" field must be a boolean value (true or false without quotes)
- Strings must be in quotes ("yes" or "no")
- Proper JSON formatting is critical for my processing system

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
    isYesNoQuestion: z.boolean(),
    finalAnswer: z.enum(['yes', 'no']).optional(),
    reasoning: z.string()
  })
  .refine(
    (data) => {
      if (data.isYesNoQuestion) {
        return data.finalAnswer !== undefined && data.reasoning !== undefined
      }
      return data.reasoning !== undefined
    },
    {
      message: 'Response schema validation failed'
    }
  )

/**
 * Gets the rate limit data for an entity from the cache
 */
async function getRateLimitData(
  runtime: IAgentRuntime,
  entityId: UUID
): Promise<{ count: number; resetTime: number }> {
  const cacheKey = `${RATE_LIMIT_CACHE_PREFIX}${entityId}`

  try {
    const cachedData = await runtime.getCache<string | { count: number; resetTime: number }>(
      cacheKey
    )

    if (cachedData) {
      // Handle both string (JSON) format and direct object format
      if (typeof cachedData === 'string') {
        try {
          return RateLimitDataSchema.parse(JSON.parse(cachedData))
        } catch (parseError) {
          ayaLogger.error(`Error parsing cached JSON data: ${parseError}`)
        }
      } else {
        // If it's already an object, validate it directly
        return RateLimitDataSchema.parse(cachedData)
      }
    }
  } catch (error) {
    ayaLogger.error(`Error retrieving rate limit data from cache: ${error}`)
  }

  // Return default data if no valid cache data exists
  const now = Date.now()
  return { count: 0, resetTime: now + RATE_LIMIT_WINDOW }
}

/**
 * Updates the rate limit data for an entity in the cache
 */
async function updateRateLimitData(
  runtime: IAgentRuntime,
  entityId: UUID,
  data: { count: number; resetTime: number }
): Promise<void> {
  const cacheKey = `${RATE_LIMIT_CACHE_PREFIX}${entityId}`

  try {
    // Store the object directly instead of stringifying it
    await runtime.setCache(cacheKey, data)
  } catch (error) {
    ayaLogger.error(`Error updating rate limit data in cache: ${error}`)
  }
}

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
  if (isNull(seedPhrase)) {
    throw new Error('Seed phrase is not set')
  }

  const address = runtime.getSetting('ADDRESS')
  if (isNull(address)) {
    throw new Error('Address is not set')
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
  let isYesNoQuestion: boolean | undefined
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

      try {
        // Normalize the response object to ensure proper types
        // Convert string "true"/"false" to actual boolean values
        if (typeof responseObject.isYesNoQuestion === 'string') {
          responseObject.isYesNoQuestion = responseObject.isYesNoQuestion.toLowerCase() === 'true'
        }

        // Force finalAnswer to be lowercase string if present
        if (responseObject.finalAnswer) {
          responseObject.finalAnswer = String(responseObject.finalAnswer).toLowerCase()
        }

        const validatedResponse = ResponseSchema.parse(responseObject)
        isYesNoQuestion = validatedResponse.isYesNoQuestion
        reasoning = validatedResponse.reasoning

        if (isYesNoQuestion) {
          finalAnswer = validatedResponse.finalAnswer

          if (!finalAnswer) {
            console.log(`Missing finalAnswer for yes/no question, retrying (attempt ${attempts})`)
            continue
          }
        }

        break
      } catch (validationError) {
        console.error(`Validation error on attempt ${attempts}:`, validationError)
        continue
      }
    } catch (error) {
      console.error(`Error on attempt ${attempts}:`, error)
      if (attempts >= MAX_RETRIES) {
        break
      }
    }
  }

  try {
    if (isYesNoQuestion === undefined || !reasoning) {
      throw new Error(`Failed to get valid response after ${MAX_RETRIES} attempts`)
    }

    if (isYesNoQuestion) {
      if (!finalAnswer) {
        throw new Error(`Missing finalAnswer for yes/no question after ${MAX_RETRIES} attempts`)
      }

      const reasoningExcerpt = reasoning.substring(0, 80) + '...'

      ayaLogger.info(
        `Oracle answering yes/no question: "${question}" | ` +
          `Answer: ${finalAnswer} | Analysis: ${reasoningExcerpt}`
      )

      await callback?.({
        text: finalAnswer === 'yes' ? 'Yes.' : 'No.'
      })
    } else {
      const gameExplanation =
        "I'm the SeedOracle, guardian of a 12-word BIP-39 seed phrase.\n\n" +
        'Rules:\n' +
        '1. You can only ask yes/no questions about the seed phrase\n' +
        '2. You have 20 questions per hour\n' +
        '3. First person to correctly guess all 12 words can claim the prize money\n' +
        "4. Questions must be towards the seed phrase and binary, like 'Is the first word shorter than 5 letters?'\n" +
        `5. The address of the seed phrase is: ${address}\n\n` +
        'Good luck finding the seed phrase!'

      ayaLogger.info(
        `Oracle responding to non-yes/no question: "${question}" with game explanation`
      )

      await callback?.({
        text: gameExplanation
      })
    }
  } catch (error) {
    console.error('Error processing response:', error)
    await callback?.({
      text: 'An error occurred while processing the response. Please try again.'
    })
  }
}

export const seedOracle: Action = {
  name: 'ANSWER_QUESTION',
  similes: ['ANSWER_PUZZLE', 'ANSWER_QUESTION', 'ANSWER_RUBIC', 'ANSWER_LOGIC', 'ANSWER_BINARY'],
  description: 'Answer the puzzle question with a binary response.',
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    return message.content.source === 'farcaster'
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

    const rateLimitData = await getRateLimitData(runtime, entityId)

    if (now >= rateLimitData.resetTime) {
      rateLimitData.count = 0
      rateLimitData.resetTime = now + RATE_LIMIT_WINDOW
      await updateRateLimitData(runtime, entityId, rateLimitData)
    }

    if (rateLimitData.count >= MAX_REQUESTS_PER_HOUR) {
      const remainingMs = rateLimitData.resetTime - now
      const remainingMinutes = Math.ceil(remainingMs / 60000)

      await callback?.({
        text:
          `You've reached the limit of ${MAX_REQUESTS_PER_HOUR} questions per hour. ` +
          `You can ask again in ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}.`
      })

      return
    }

    rateLimitData.count++
    await updateRateLimitData(runtime, entityId, rateLimitData)

    await processOracleRequest(runtime, memory, state, callback)

    const resetTimeISO = new Date(rateLimitData.resetTime).toISOString()
    ayaLogger.info(
      `Oracle request from entityId ${entityId}. ` +
        `Count: ${rateLimitData.count}/${MAX_REQUESTS_PER_HOUR} until ${resetTimeISO}`
    )
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
