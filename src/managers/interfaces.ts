import { Content } from '@elizaos/core'
import { Context } from 'telegraf'

export interface ITelegramManager {
  registerCommand(command: string, handler: (ctx: Context) => Promise<void>): void

  sendMessage(params: {
    chatId: number | string
    content: Content
    replyToMessageId?: number | undefined
  }): Promise<number>
}
