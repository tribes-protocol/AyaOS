import { AgentcoinRuntime } from '@/common/runtime'
import {
  Action,
  Content,
  elizaLogger,
  HandlerCallback,
  Media,
  Memory,
  State,
  stringToUuid
} from '@elizaos/core'

export interface SendPhotoContent extends Content {
  photoSent: boolean
  message: string
}

export const sendPhotoAction: Action = {
  name: 'SEND_PHOTO',
  similes: ['SHARE_IMAGE', 'SHOW_PICTURE', 'DISPLAY_PHOTO', 'SEND_IMAGE', 'SHARE_PICTURE'],
  description:
    'Sends a hardcoded photo when the user requests an image or photo. This is a test action that demonstrates how to send media attachments.',
  validate: async () => {
    return true
  },
  handler: async (
    runtime: AgentcoinRuntime,
    message: Memory,
    state: State,
    _options: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<boolean> => {
    elizaLogger.info('Starting SEND_PHOTO handler...')

    if (!state) {
      state = await runtime.composeState(message)
    } else {
      state = await runtime.updateRecentMessageState(state)
    }

    // Check if the message contains a request for a photo
    const messageText = message.content.text?.toLowerCase() || ''
    if (!messageText.includes('send me a photo') && !messageText.includes('send me an image')) {
      if (callback) {
        callback({
          text: 'I can send you a photo if you ask for one. Try saying "send me a photo".',
          content: {
            photoSent: false,
            message: 'No photo request detected'
          }
        }).catch((error) => {
          elizaLogger.error('Error sending callback:', error)
        })
      }
      return false
    }

    try {
      // Create the hardcoded media attachment
      const media: Media = {
        id: stringToUuid('investment-performance-photo'),
        url: 'https://s3.us-east-1.amazonaws.com/agentcoin.tribes.xyz/images/753206fac25ca44e9ce5fa13bce7a38e',
        title: 'investment performance',
        source: 'social-card',
        description: 'status of your investment',
        text: 'status of your investment',
        contentType: 'image/png'
      }

      if (callback) {
        callback({
          text: 'Here is the photo you requested!',
          content: {
            photoSent: true,
            message: 'Photo sent successfully'
          },
          attachments: [media]
        }).catch((error) => {
          elizaLogger.error('Error sending callback:', error)
        })
      }

      return true
    } catch (error) {
      elizaLogger.error('Error sending photo:', JSON.stringify(error, null, 2))
      if (callback) {
        callback({
          text: 'Sorry, there was an error sending the photo.',
          content: {
            photoSent: false,
            message: 'Error sending photo'
          }
        }).catch((error) => {
          elizaLogger.error('Error sending callback:', error)
        })
      }
      return false
    }
  },
  examples: [
    [
      {
        user: '{{user1}}',
        content: {
          text: 'Hey, can you send me a photo?'
        }
      },
      {
        user: '{{user2}}',
        content: {
          text: "Sure, I'll send you a photo right away.",
          action: 'SEND_PHOTO'
        }
      },
      {
        user: '{{user2}}',
        content: {
          text: 'Here is the photo you requested!'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: {
          text: "I'd like to see an image of my investment performance."
        }
      },
      {
        user: '{{user2}}',
        content: {
          text: "I'll share that with you.",
          action: 'SEND_PHOTO'
        }
      },
      {
        user: '{{user2}}',
        content: {
          text: "Here's the status of your investment."
        }
      }
    ]
  ]
}
