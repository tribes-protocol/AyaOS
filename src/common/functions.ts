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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ensureString(value: any, message: string | undefined = undefined): string {
  if (!value) {
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
            console.error(`Error: ${error}`)
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
