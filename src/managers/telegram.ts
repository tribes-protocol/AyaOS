import { ITelegramManager } from '@/managers/interfaces'
import { TelegramContent } from '@/plugins/telegram/types'
import { Context } from 'telegraf'

export class TelegramManager implements ITelegramManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly telegram: any) {}

  registerCommand(command: string, handler: (ctx: Context) => Promise<void>): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    this.telegram.addCommandHandler(command, handler)
  }

  async sendMessage(params: {
    chatId: number | string
    content: TelegramContent
    replyToMessageId?: number | undefined
  }): Promise<void> {
    const { chatId, content, replyToMessageId } = params
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    await this.telegram.messageManager.sendMessage(chatId, content, replyToMessageId)
  }
}
