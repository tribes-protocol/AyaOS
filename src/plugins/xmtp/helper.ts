import { Identifier, IdentifierKind, Signer } from '@xmtp/node-sdk'
import { getRandomValues } from 'node:crypto'
import { fromString, toString } from 'uint8arrays'
import { toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const createSigner = (privateKey: `0x${string}`): Signer => {
  const account = privateKeyToAccount(privateKey)
  const accountIdentifier: Identifier = {
    identifier: account.address,
    identifierKind: IdentifierKind.Ethereum
  }

  return {
    type: 'EOA',
    getIdentifier: async () => accountIdentifier,
    signMessage: async (message: string) => {
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
