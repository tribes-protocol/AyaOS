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
    'Lists all available capabilities and actions that the agent can perform. This action should ALWAYS be used when a user asks "what can you do?", "what are your capabilities?", "help", or similar questions about the agent\'s abilities. Never use REPLY for these types of questions.',
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
    // Collect all available actions
    const actionsData = runtime.actions.filter((action) => !IGNORE_ACTIONS.has(action.name))

    // Create description list for summarization
    const actionDescriptions = actionsData
      .map((action) => {
        return `- ${action.description}`
      })
      .join('\n')

    // Generate a user-friendly summary through LLM
    const summary = await runtime.useModel(ModelType.TEXT_LARGE, {
      prompt: `Below is a list of capabilities this AI assistant has.
       Please create a concise, user-friendly summary in bullet point format that explains these 
       capabilities in simple terms. Group similar capabilities together where appropriate.
       
       Focus on what the assistant can do for the user, not technical implementation details.
       Make it engaging and clear for someone who wants to know what this assistant can help with.
       
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
          text: "Here's what I can do for you:\n\n- Answer questions and provide information\n- Search the web for real-time information\n- ...",
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
          text: "Here's what I can do for you:\n\n- Help with information retrieval\n- Search for current events and data\n- ...",
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
          text: "Here's what I can do for you:\n\n- Provide informative responses\n- Search the internet for up-to-date information\n- ...",
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
          text: "Here's what I can do for you:\n\n- Answer your questions with detailed information\n- Look up current information online\n- ...",
          actions: ['CAPABILITIES']
        }
      }
    ]
  ]
}
