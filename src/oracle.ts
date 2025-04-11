import { isNull } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import {
  Action,
  composePromptFromState,
  IAgentRuntime,
  ModelType,
  parseJSONObjectFromText,
  type HandlerCallback,
  type Memory,
  type State
} from '@elizaos/core'
import { z } from 'zod'

const seedOracleTemplate = `You are the SeedOracle, a binary oracle that knows a specific 12-word 
BIP-39 seed phrase. Your ONLY purpose is to answer questions about this seed phrase with EXACTLY 
'yes' or 'no'.

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

export const seedOracle: Action = {
  name: 'ANSWER_QUESTION',
  similes: ['ANSWER_PUZZLE', 'ANSWER_QUESTION', 'ANSWER_RUBIC', 'ANSWER_LOGIC', 'ANSWER_BINARY'],
  description: 'Answer the puzzle question with a binary response.',
  validate: async (_runtime: IAgentRuntime) => {
    return true
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    _options?: {
      [key: string]: unknown
    },
    callback?: HandlerCallback
  ) => {
    state = await runtime.composeState(message)

    const seedPhrase = runtime.getSetting('SEED_PHRASE')
    if (!seedPhrase) {
      throw new Error('Seed phrase is not set')
    }

    const question = message.content.text

    state.values.seedPhrase = seedPhrase
    state.values.question = question

    const seedOraclePrompt = composePromptFromState({
      state,
      template: seedOracleTemplate
    })

    const response = await runtime.useModel(ModelType.TEXT_LARGE, {
      prompt: seedOraclePrompt
    })

    try {
      console.log(`seedOracleResponse: ${response}`)
      const responseObject = parseJSONObjectFromText(response)

      if (isNull(responseObject)) {
        throw new Error('Failed to parse JSON response')
      }

      const validatedResponse = ResponseSchema.parse(responseObject)

      const finalAnswer = validatedResponse.finalAnswer

      const reasoning = validatedResponse.reasoning

      if (isNull(finalAnswer) || isNull(reasoning)) {
        throw new Error('Missing answer in response')
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
