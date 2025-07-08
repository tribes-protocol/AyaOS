import { ayaLogger } from '@/common/logger'
import { validateResponse } from '@/llms/response-validator'
import {
  Action,
  composePromptFromState,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type State
} from '@elizaos/core'
import { z } from 'zod'

export const ReplyActionResponseSchema = z.object({
  thought: z.string(),
  message: z.string()
})

const replyTemplate = `# Task: Generate dialog for the character {{agentName}}.
{{providers}}
# Instructions: Write the next message for {{agentName}}.
"thought" should be a short description of what the agent is thinking about and planning.
"message" should be the next message for {{agentName}} which they will send to the conversation.

Response format should be formatted in a valid JSON block like this:
\`\`\`json
{
    "thought": "<string>",
    "message": "<string>"
}
\`\`\`

Your response should include the valid JSON block and nothing else.`

export const replyAction: Action = {
  name: 'REPLY',
  similes: ['REPLY_TO_MESSAGE', 'SEND_REPLY', 'RESPOND', 'RESPONSE'],
  description:
    "Replies to the current conversation with the generated message text. This is the default action when no other action matches the user's request. Use REPLY at the start of a chain of actions as an acknowledgement, and at the end as a final response.",
  validate: async (_runtime: IAgentRuntime) => {
    return true
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
    // Print message without the embedding property
    const { embedding: _embedding, ...messageWithoutEmbedding } = message
    ayaLogger.info('reply action message', messageWithoutEmbedding)
    // Only generate response using LLM if no suitable response was found
    state = await runtime.composeState(message, [
      ...(message.content.providers ?? []),
      'RECENT_MESSAGES',
      'CHARACTER'
    ])

    const prompt = composePromptFromState({
      state,
      template: replyTemplate
    })

    const response: {
      thought: string
      message: string
    } = await runtime.useModel(ModelType.OBJECT_LARGE, {
      prompt,
      schema: ReplyActionResponseSchema
    })

    ayaLogger.info('reply action response', response)

    const responseContent = {
      thought: response.thought,
      text: response.message
    }

    const validatedResponse = await validateResponse({
      runtime,
      response: responseContent,
      requestText: message.content.text || '',
      context: prompt
    })

    if (validatedResponse) {
      ayaLogger.info('reply action response is valid', validatedResponse)
      await callback?.(validatedResponse)
    } else {
      ayaLogger.error('reply action response is not valid', responseContent)
    }
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Hello there!'
        }
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Hi! How can I help you today?',
          actions: ['REPLY']
        }
      }
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: "What's your favorite color?"
        }
      },
      {
        name: '{{name2}}',
        content: {
          text: 'I really like deep shades of blue. They remind me of the ocean and the night sky.',
          actions: ['REPLY']
        }
      }
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Can you explain how neural networks work?'
        }
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Let me break that down for you in simple terms...',
          actions: ['REPLY']
        }
      }
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Could you help me solve this math problem?'
        }
      },
      {
        name: '{{name2}}',
        content: {
          text: "Of course! Let's work through it step by step.",
          actions: ['REPLY']
        }
      }
    ]
  ]
}
