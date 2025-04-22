import { TelegramContent } from '@/plugins/telegram/types'
import { Context } from 'telegraf'

export interface ITelegramManager {
  registerCommand(command: string, handler: (ctx: Context) => Promise<void>): void

  sendMessage(params: {
    chatId: number | string
    content: TelegramContent
    replyToMessageId?: number | undefined
  }): Promise<number | undefined>
}
