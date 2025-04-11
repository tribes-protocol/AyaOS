import { ITelegramManager } from '@/managers/interfaces'
import { Content } from '@elizaos/core'

export class TelegramManager implements ITelegramManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly telegram: any) {}

  async sendMessage(params: {
    chatId: number | string
    content: Content
    replyToMessageId?: number | undefined
  }): Promise<number> {
    const { chatId, content, replyToMessageId } = params
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const [message] = await this.telegram.messageManager.sendMessage(
      chatId,
      content,
      replyToMessageId
    )
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return message.message_id
  }
}
