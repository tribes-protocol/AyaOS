import { isRequiredString } from '@/common/functions'
import {
  Action,
  composePromptFromState,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type State
} from '@elizaos/core'

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
  similes: ['GREET', 'REPLY_TO_MESSAGE', 'SEND_REPLY', 'RESPOND', 'RESPONSE'],
  description:
    'Replies to the current conversation with the text from the generated message. Default if the agent is responding with a message and no other action. Use REPLY at the beginning of a chain of actions as an acknowledgement, and at the end of a chain of actions as a final response.',
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
    callback?: HandlerCallback,
    responses?: Memory[]
  ) => {
    // Find all responses with REPLY action and text
    const existingResponses = responses?.filter(
      (response) => response.content.actions?.includes('REPLY') && response.content.message
    )

    // If we found any existing responses, use them and skip LLM
    if (existingResponses && existingResponses.length > 0) {
      for (const response of existingResponses) {
        const responseContent = {
          thought: response.content.thought || 'Using provided text for reply',
          text: isRequiredString(response.content.message) ? response.content.message : '',
          actions: ['REPLY']
        }
        await callback?.(responseContent)
      }
      return
    }

    // Only generate response using LLM if no suitable response was found
    state = await runtime.composeState(message, [
      ...(message.content.providers ?? []),
      'RECENT_MESSAGES'
    ])

    const prompt = composePromptFromState({
      state,
      template: replyTemplate
    })

    const response: {
      thought: string
      message: string
    } = await runtime.useModel(ModelType.OBJECT_LARGE, {
      prompt
    })

    const responseContent = {
      thought: isRequiredString(response.thought) ? response.thought : '',
      text: isRequiredString(response.message) ? response.message : '',
      actions: ['REPLY']
    }

    await callback?.(responseContent)
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
