import { isNull } from '@/common/functions'
import { EthAddress } from '@/common/types'
import { IXmtpManager } from '@/managers/interfaces'
import { XmtpContent } from '@/plugins/xmtp/types'
import { ContentTypeReaction, Reaction } from '@xmtp/content-type-reaction'
import { ContentTypeReply } from '@xmtp/content-type-reply'
import { ContentTypeText } from '@xmtp/content-type-text'
import { ContentTypeWalletSendCalls } from '@xmtp/content-type-wallet-send-calls'
import { IdentifierKind, Client as XmtpClient } from '@xmtp/node-sdk'

export class XmtpManager implements IXmtpManager {
  constructor(private readonly xmtpClient: XmtpClient) {}

  async sendMessage(params: {
    identifier: EthAddress
    content: XmtpContent
    replyToMessageId?: string | undefined
  }): Promise<string | undefined> {
    const { identifier, content, replyToMessageId } = params

    await this.xmtpClient.conversations.sync()

    const inboxId = await this.xmtpClient.getInboxIdByIdentifier({
      identifier,
      identifierKind: IdentifierKind.Ethereum
    })

    if (isNull(inboxId)) {
      throw new Error(`Inbox ID not found for identifier: ${identifier}`)
    }

    const conversation = this.xmtpClient.conversations.getDmByInboxId(inboxId)
    if (!conversation) {
      throw new Error(`Conversation not found: ${inboxId}`)
    }

    if (content.transactionCalls) {
      return conversation.send(content.transactionCalls, ContentTypeWalletSendCalls)
    }

    if (content.reaction) {
      const reaction: Reaction = {
        ...content.reaction,
        reference: replyToMessageId || ''
      }
      return conversation.send(reaction, ContentTypeReaction)
    }

    if (replyToMessageId) {
      const reply = {
        reference: replyToMessageId,
        content: content.text,
        contentType: ContentTypeText
      }
      return conversation.send(reply, ContentTypeReply)
    }

    console.log('sending message to xmtp', {
      inboxId,
      conversation,
      content
    })

    return conversation.send(content.text, ContentTypeText)
  }
}
