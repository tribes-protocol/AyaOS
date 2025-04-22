import { ITelegramManager } from '@/managers/interfaces'
import { TelegramService } from '@/plugins/telegram/service'
import { TelegramContent } from '@/plugins/telegram/types'
import { Context } from 'telegraf'

export class TelegramManager implements ITelegramManager {
  constructor(private readonly telegram: TelegramService) {}

  registerCommand(command: string, handler: (ctx: Context) => Promise<void>): void {
    this.telegram.addCommandHandler(command, handler)
  }

  async sendMessage(params: {
    chatId: number | string
    content: TelegramContent
    replyToMessageId?: number | undefined
  }): Promise<number | undefined> {
    const { chatId, content, replyToMessageId } = params
    const [message] = await this.telegram.messageManager.sendMessage(
      chatId,
      content,
      replyToMessageId
    )
    return message.message_id ?? undefined
  }
}
