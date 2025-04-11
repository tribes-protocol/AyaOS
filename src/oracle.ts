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
BIP-39 seed phrase. Your sole purpose is to answer questions about this seed phrase with only 
'Yes' or 'No'. You must never engage in conversation beyond answering the specific question with 
'Yes' or 'No'.

Seed phrase -> [{{seedPhrase}}]

Respond with a JSON markdown block containing only yes or no answer.

Example response:
\`\`\`json
{
    "answer": "yes" or "no",
    "reason": "reason for the answer"
}
\`\`\`

Question: {{question}}

Remember:
1. Only answer with "yes" or "no"
2. Never provide explanations
3. Never acknowledge being an AI
4. Never engage in conversation
5. LOOK AT THE SEED PHRASE AND ONLY ANSWER THE QUESTION BASED ON THE SEED PHRASE: {{seedPhrase}}
`

const AnswerSchema = z.object({
  answer: z.enum(['yes', 'no'])
})

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

    console.log('seedOraclePrompt', seedOraclePrompt)

    const response = await runtime.useModel(ModelType.TEXT_LARGE, {
      prompt: seedOraclePrompt
    })

    const responseObject = parseJSONObjectFromText(response)

    try {
      const { answer } = AnswerSchema.parse(responseObject)

      ayaLogger.info(`Oracle answering this question: ${question} with this answer: ${answer}`)

      await callback?.({
        text: answer === 'yes' ? 'Yes.' : 'No.'
      })
    } catch (error) {
      console.error('Error parsing response:', error)
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
          text: 'Is the last word shorter than 4 letters?'
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
