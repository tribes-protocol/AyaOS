import { isNull } from '@/common/functions'
import { Identifier, IdentifierKind, Signer } from '@xmtp/node-sdk'
import { getRandomValues } from 'node:crypto'
import { fromString, toString } from 'uint8arrays'
import { Account, toBytes } from 'viem'

export const createSigner = (account: Account): Signer => {
  const accountIdentifier: Identifier = {
    identifier: account.address,
    identifierKind: IdentifierKind.Ethereum
  }

  return {
    type: 'EOA',
    getIdentifier: async () => accountIdentifier,
    signMessage: async (message: string) => {
      if (isNull(account.signMessage)) {
        throw new Error('Account does not have a signMessage method')
      }

      const signature = await account.signMessage({
        message
      })
      return toBytes(signature)
    }
  }
}

export const generateEncryptionKeyHex = (): string => {
  const uint8Array = getRandomValues(new Uint8Array(32))
  return toString(uint8Array, 'hex')
}

export const getEncryptionKeyFromHex = (hex: string): Uint8Array => {
  return fromString(hex, 'hex')
}
