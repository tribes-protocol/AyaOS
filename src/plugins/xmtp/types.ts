import { Content } from '@elizaos/core'
import { WalletSendCallsParams } from '@xmtp/content-type-wallet-send-calls'

/**
 * Extention of the core Content type just for Telegram
 */
export interface XmtpContent extends Content {
  transactionCalls?: WalletSendCallsParams
}
