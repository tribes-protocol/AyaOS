import { EthAddress } from '@/common/types'
import { TelegramContent } from '@/plugins/telegram/types'
import { PostTweetRequest, PostTweetResponse } from '@/plugins/twitter/client'
import { XmtpContent } from '@/plugins/xmtp/types'
import { CastId, CastWithInteractions } from '@neynar/nodejs-sdk/build/api'
import { Context } from 'telegraf'

export interface ITelegramManager {
  registerCommand(command: string, handler: (ctx: Context) => Promise<void>): void

  sendMessage(params: {
    chatId: number | string
    content: TelegramContent
    replyToMessageId?: number | undefined
  }): Promise<number | undefined>
}

export interface IXmtpManager {
  sendMessage(params: {
    identifier: EthAddress
    content: XmtpContent
    replyToMessageId?: string | undefined
  }): Promise<string | undefined>
}

export interface IFarcasterManager {
  sendCast(params: {
    text: string
    url?: string
    inReplyTo?: CastId
  }): Promise<CastWithInteractions[]>
  getCast(params: { hash: string }): Promise<CastWithInteractions>
}

export interface ITwitterManager {
  postTweet(params: PostTweetRequest): Promise<PostTweetResponse>
}
