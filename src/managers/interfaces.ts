import { Content } from '@elizaos/core'

export interface ITelegramManager {
  sendMessage(params: {
    chatId: number | string
    content: Content
    replyToMessageId?: number | undefined
  }): Promise<number>
}
