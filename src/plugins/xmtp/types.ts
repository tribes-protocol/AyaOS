import { Content } from '@elizaos/core'
import { Reaction } from '@xmtp/content-type-reaction'
import { WalletSendCallsParams } from '@xmtp/content-type-wallet-send-calls'

/**
 * Extention of the core Content type just for Telegram
 */
export interface XmtpContent extends Content {
  transactionCalls?: WalletSendCallsParams
  reaction?: Omit<Reaction, 'reference' | 'referenceInboxId'>
  shouldReply?: boolean
}
