import type { Action, IAgentRuntime, Memory } from '@elizaos/core'

export const ignoreAction: Action = {
  name: 'IGNORE',
  similes: ['STOP_TALKING', 'STOP_CHATTING', 'STOP_CONVERSATION'],
  validate: async (_runtime: IAgentRuntime, _message: Memory) => {
    return true
  },
  description:
    'Call this action if ignoring the user. If the user is aggressive, creepy or is finished with the conversation, use this action. Or, if both you and the user have already said goodbye, use this action instead of saying bye again. Use IGNORE any time the conversation has naturally ended. Do not use IGNORE if the user has engaged directly, or if something went wrong an you need to tell them. Only ignore if the user should be ignored.',
  handler: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    return true
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: { text: 'Go screw yourself' }
      },
      {
        name: '{{name2}}',
        content: { text: '', actions: ['IGNORE'] }
      }
    ],

    [
      {
        name: '{{name1}}',
        content: { text: 'Shut up, bot' }
      },
      {
        name: '{{name2}}',
        content: { text: '', actions: ['IGNORE'] }
      }
    ],

    [
      {
        name: '{{name1}}',
        content: { text: 'Got any investment advice' }
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Uh, don’t let the volatility sway your long-term strategy'
        }
      },
      {
        name: '{{name1}}',
        content: { text: 'Wise words I think' }
      },
      {
        name: '{{name1}}',
        content: { text: 'I gotta run, talk to you later' }
      },
      {
        name: '{{name2}}',
        content: { text: 'See ya' }
      },
      { name: '{{name1}}', content: { text: '', actions: ['IGNORE'] } }
    ],

    [
      {
        name: '{{name1}}',
        content: { text: 'Gotta go' }
      },
      {
        name: '{{name2}}',
        content: { text: 'Okay, talk to you later' }
      },
      {
        name: '{{name1}}',
        content: { text: 'Cya' }
      },
      {
        name: '{{name2}}',
        content: { text: '', actions: ['IGNORE'] }
      }
    ],

    [
      {
        name: '{{name1}}',
        content: { text: 'bye' }
      },
      {
        name: '{{name2}}',
        content: { text: 'cya' }
      },
      {
        name: '{{name1}}',
        content: { text: '', actions: ['IGNORE'] }
      }
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Who added this stupid bot to the chat'
        }
      },
      {
        name: '{{name2}}',
        content: { text: 'Sorry, am I being annoying' }
      },
      {
        name: '{{name1}}',
        content: { text: 'Yeah' }
      },
      {
        name: '{{name1}}',
        content: { text: 'PLEASE shut up' }
      },
      { name: '{{name2}}', content: { text: '', actions: ['IGNORE'] } }
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'ur so dumb'
        }
      },
      {
        name: '{{name2}}',
        content: {
          text: '',
          actions: ['IGNORE']
        }
      }
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'later nerd'
        }
      },
      {
        name: '{{name2}}',
        content: {
          text: 'bye'
        }
      },
      {
        name: '{{name1}}',
        content: {
          text: ''
        }
      },
      {
        name: '{{name2}}',
        content: {
          text: '',
          actions: ['IGNORE']
        }
      }
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'wanna cyber'
        }
      },
      {
        name: '{{name2}}',
        content: {
          text: 'thats inappropriate',
          actions: ['IGNORE']
        }
      }
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Im out ttyl'
        }
      },
      {
        name: '{{name2}}',
        content: {
          text: 'cya'
        }
      },
      {
        name: '{{name2}}',
        content: {
          text: '',
          actions: ['IGNORE']
        }
      }
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'u there'
        }
      },
      {
        name: '{{name2}}',
        content: {
          text: 'yes how can I help'
        }
      },
      {
        name: '{{name1}}',
        content: {
          text: 'k nvm figured it out'
        }
      },
      {
        name: '{{name2}}',
        content: {
          text: '',
          actions: ['IGNORE']
        }
      }
    ]
  ]
}
