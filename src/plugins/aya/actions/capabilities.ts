import { isNull } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import {
  Action,
  IAgentRuntime,
  ModelType,
  type HandlerCallback,
  type Memory,
  type State
} from '@elizaos/core'

const IGNORE_ACTIONS = new Set(['CAPABILITIES', 'IGNORE', 'REPLY'])

export const capabilitiesAction: Action = {
  name: 'CAPABILITIES',
  similes: [
    'WHAT_CAN_YOU_DO',
    'ABILITIES',
    'FEATURES',
    'HELP',
    'FUNCTIONS',
    'COMMANDS',
    'SKILLS',
    'CAPABILITIES_LIST',
    'AVAILABLE_ACTIONS'
  ],
  description:
    'Lists all available capabilities and actions that the agent can perform. ' +
    'This action should ALWAYS be used when a user asks "what can you do?",' +
    ' "what are your capabilities?", "help", or similar questions about the agent\'s abilities.' +
    ' Never use REPLY for these types of questions.' +
    'IMPORTANT: Only call CAPABILITIES action, and NEVER call the REPLY action',
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
    // Print all available action names using ayaLogger
    const actionNames = runtime.actions.map((action) => action.name)
    ayaLogger.info('[capabilitiesAction] Available actions:', actionNames)

    // Collect all available actions
    const actionsData = runtime.actions.filter((action) => !IGNORE_ACTIONS.has(action.name))

    // Create description list for summarization
    const actionDescriptions = actionsData
      .map((action) => {
        return `- ${action.description}`
      })
      .join('\n')

    // If no actions are available, return a simple message
    if (isNull(actionDescriptions) || actionDescriptions.length === 0) {
      await callback?.({
        text: "I currently don't have any capabilities"
      })
      return
    }

    // Generate a user-friendly, conversational summary through LLM
    const source = message.content?.source
    const useMarkdown = source !== 'xmtp'
    const formatInstruction = useMarkdown
      ? 'Format your response in Markdown, using clear structure (for example: headings, bullet points, and bold for key terms).'
      : 'Format your response in a clear, structured way (do not use Markdown formatting).'

    const summary = await runtime.useModel(ModelType.TEXT_LARGE, {
      prompt: `Hello! Here’s what I can help you with:

Below is a list of my capabilities. Please write a friendly, natural-sounding summary 
(as if you're talking to a person) that explains what I can do for the user. Group similar 
abilities together, and make it easy to scan. Avoid technical jargon or implementation details.

Also try to keep the as concise as possible without losing any of key details.

${formatInstruction}

Capabilities:
${actionDescriptions}`
    })

    await callback?.({
      text: summary
    })
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'What can you do?'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          actions: ['CAPABILITIES']
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Show me your capabilities'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          actions: ['CAPABILITIES']
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'What features do you have?'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          actions: ['CAPABILITIES']
        }
      }
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Help! What commands can I use?'
        }
      },
      {
        name: '{{agentName}}',
        content: {
          actions: ['CAPABILITIES']
        }
      }
    ]
  ]
}
