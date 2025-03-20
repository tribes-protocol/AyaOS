import { UUID_PATTERN } from '@/common/constants'
import {
  ChatChannel,
  ChatChannelKind,
  ChatChannelKindSchema,
  ChatChannelSchema,
  CoinChannelSchema,
  DMChannelSchema,
  GitState,
  Identity,
  IdentitySchema
} from '@/common/types'
import { elizaLogger, KnowledgeItem, Memory, UUID } from '@elizaos/core'
import crypto, { createHash } from 'crypto'
import EC from 'elliptic'

// eslint-disable-next-line new-cap
export const ec = new EC.ec('p256')

export function prepend0x(value: string): `0x${string}` {
  if (value.startsWith('0x')) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return value as `0x${string}`
  }
  return `0x${value}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isRequiredString(arg: any): arg is string {
  return typeof arg === 'string'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isBigInt(value: any): value is bigint {
  return typeof value === 'bigint'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isNull(obj: any): obj is null | undefined {
  return obj === null || obj === undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toJsonTree(obj: any): any {
  if (isNull(obj)) {
    return null
  }

  // transform each item for arrays
  if (Array.isArray(obj)) {
    return obj.map(toJsonTree)
  }

  // transform URLs to string
  if (obj instanceof URL) {
    return obj.toString()
  }

  // transform BigInt to string
  if (isBigInt(obj)) {
    return obj.toString()
  }

  // transfer BN to decimal string
  // if (BN.isBN(obj)) {
  //   return obj.toString(10)
  // }

  // return primitives and null/undefined unchanged
  if (typeof obj !== 'object' || isNull(obj)) {
    return obj
  }

  // use toJSON() if available
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (typeof obj.toJSON === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return obj.toJSON()
  }

  // transform each value for objects
  return Object.fromEntries(Object.entries(obj).map(([key, val]) => [key, toJsonTree(val)]))
}

export function ensure<T>(value: T | null | undefined, message: string | undefined = undefined): T {
  if (isNull(value)) {
    throw new Error(message || 'Value is undefined')
  }
  return value
}

export function serializeIdentity(identity: Identity): string {
  return identity.toString()
}

export function deserializeIdentity(identityString: string): Identity {
  return IdentitySchema.parse(identityString)
}

export function sortIdentities(first: Identity, second: Identity): [Identity, Identity] {
  const firstStr = serializeIdentity(first).toLowerCase()
  const secondStr = serializeIdentity(second).toLowerCase()
  return firstStr <= secondStr ? [first, second] : [second, first]
}

export function isEqualGitState(state1: GitState, state2: GitState): boolean {
  return (
    state1.repositoryUrl === state2.repositoryUrl &&
    state1.branch === state2.branch &&
    state1.commit === state2.commit
  )
}

export function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number
    logError: boolean
    ms: number
  } = {
    maxRetries: 3,
    logError: true,
    ms: 1000
  }
): Promise<T> {
  const { maxRetries, logError, ms } = options
  return new Promise((resolve, reject) => {
    let retries = 0
    const attempt = (): void => {
      fn()
        .then(resolve)
        .catch((error) => {
          if (logError) {
            elizaLogger.error(`Error: ${error}`)
          }
          if (retries < maxRetries) {
            retries++
            setTimeout(attempt, ms)
          } else {
            reject(error)
          }
        })
    }

    attempt()
  })
}

export function serializeChannel(data: ChatChannel): string {
  const parsed = ChatChannelSchema.parse(data)
  switch (parsed.kind) {
    case ChatChannelKind.COIN:
      return `coin:${parsed.chainId}:${parsed.address}`
    case ChatChannelKind.DM: {
      const [first, second] = sortIdentities(parsed.firstIdentity, parsed.secondIdentity)
      return `dm:${serializeIdentity(first)}:${serializeIdentity(second)}`
    }
  }
}

export function deserializeChannel(channelString: string): ChatChannel {
  const parts = channelString.split(':')
  if (parts.length !== 3) throw new Error('Invalid chat channel data')

  const [prefix] = parts
  const kind = ChatChannelKindSchema.parse(prefix)
  switch (kind) {
    case ChatChannelKind.COIN: {
      const [_, chainId, address] = parts
      return CoinChannelSchema.parse({ kind, chainId, address })
    }
    case ChatChannelKind.DM: {
      const [_, firstIdentity, secondIdentity] = parts
      if (isNull(firstIdentity) || isNull(secondIdentity)) {
        throw new Error('Invalid chat channel data')
      }

      const [first, second] = sortIdentities(
        deserializeIdentity(firstIdentity),
        deserializeIdentity(secondIdentity)
      )

      const res = DMChannelSchema.parse({ kind, firstIdentity: first, secondIdentity: second })
      return res
    }
  }
}

export function isValidSignature(message: string, publicKey: string, signature: string): boolean {
  try {
    const keyPair = ec.keyFromPublic(publicKey, 'hex')

    const msgHash = createHash('sha256').update(message).digest()

    return keyPair.verify(msgHash, signature)
  } catch (error) {
    console.error('Signature verification error:', error)
    return false
  }
}

export function hasActions(responses: Memory[]): boolean {
  for (const messageResponse of responses) {
    const action = messageResponse.content.action
    if (isNull(action) || action.toUpperCase() === 'NONE') {
      continue
    }

    elizaLogger.info(`found action: ${action}`)
    return true
  }

  elizaLogger.info('no actions to process, done!')
  return false
}

export function calculateChecksum(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

// copied from elizaos
export function formatKnowledge(knowledge: KnowledgeItem[]): string {
  // Group related content in a more natural way
  return knowledge
    .map((item) => {
      // Get the main content text
      const text = item.content.text

      // Clean up formatting but maintain natural text flow
      const cleanedText = text.trim().replace(/\n{3,}/g, '\n\n') // Replace excessive newlines

      return cleanedText
    })
    .join('\n\n') // Separate distinct pieces with double newlines
}

/**
 * Ensures a string is a valid UUID format.
 * If the input is already a valid UUID, it returns it.
 * Otherwise, it throws an error.
 *
 * @param input - The string to validate as a UUID
 * @returns The validated UUID
 * @throws Error if the input is not a valid UUID
 */
export function ensureUUID(input?: string | null | undefined): UUID {
  if (isNull(input)) {
    throw new Error('Input is undefined')
  }

  if (!UUID_PATTERN.test(input)) {
    throw new Error(`Invalid UUID format: ${input}`)
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return input as UUID
}
