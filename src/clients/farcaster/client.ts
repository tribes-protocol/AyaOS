import type { FarcasterConfig } from '@/clients/farcaster/environment'
import type {
  Cast,
  CastId,
  FidRequest,
  NeynarCastResponse,
  NeynarCastResponseRaw,
  Profile
} from '@/clients/farcaster/types'
import { isNull } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import { type IAgentRuntime } from '@elizaos/core'
import { type NeynarAPIClient, isApiErrorResponse } from '@neynar/nodejs-sdk'

export class FarcasterClient {
  runtime: IAgentRuntime
  neynar: NeynarAPIClient
  signerUuid: string
  cache: Map<string, unknown>
  lastInteractionTimestamp: Date
  farcasterConfig: FarcasterConfig

  constructor(opts: {
    runtime: IAgentRuntime
    url: string
    ssl: boolean
    neynar: NeynarAPIClient
    signerUuid: string
    cache: Map<string, unknown>
    farcasterConfig: FarcasterConfig
  }) {
    this.cache = opts.cache
    this.runtime = opts.runtime
    this.neynar = opts.neynar
    this.signerUuid = opts.signerUuid
    this.lastInteractionTimestamp = new Date()
    this.farcasterConfig = opts.farcasterConfig
  }

  async loadCastFromNeynarResponse(neynarResponse: NeynarCastResponseRaw): Promise<Cast> {
    const profile = await this.getProfile(neynarResponse.author.fid)
    if (isNull(neynarResponse.parent_author)) {
      throw new Error('Parent author not found')
    }
    return {
      hash: neynarResponse.hash,
      authorFid: neynarResponse.author.fid,
      text: neynarResponse.text,
      profile,
      ...(neynarResponse.parent_hash
        ? {
            inReplyTo: {
              hash: neynarResponse.parent_hash,
              fid: neynarResponse.parent_author.fid
            }
          }
        : {}),
      timestamp: new Date(neynarResponse.timestamp)
    }
  }

  async publishCast(
    cast: string,
    parentCastId: CastId | undefined,
    // eslint-disable-next-line
    retryTimes?: number
  ): Promise<NeynarCastResponse | undefined> {
    try {
      const result = await this.neynar.publishCast({
        signerUuid: this.signerUuid,
        text: cast,
        parent: parentCastId?.hash
      })
      if (result.success) {
        return {
          hash: result.cast.hash,
          authorFid: result.cast.author.fid,
          text: result.cast.text
        }
      }
    } catch (err) {
      if (isApiErrorResponse(err)) {
        ayaLogger.error('Neynar error: ', err.response.data)
        throw err.response.data
      } else {
        ayaLogger.error('Error: ', err)
        throw err
      }
    }
  }

  async getCast(castHash: string): Promise<Cast | undefined> {
    try {
      if (this.cache.has(`farcaster/cast/${castHash}`)) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        return this.cache.get(`farcaster/cast/${castHash}`) as Cast
      }

      const response = await this.neynar.lookupCastByHashOrWarpcastUrl({
        identifier: castHash,
        type: 'hash'
      })
      const cast = {
        hash: response.cast.hash,
        authorFid: response.cast.author.fid,
        text: response.cast.text,
        profile: {
          fid: response.cast.author.fid,
          name: response.cast.author.display_name || 'anon',
          username: response.cast.author.username
        },
        ...(response.cast.parent_hash
          ? {
              inReplyTo: {
                hash: response.cast.parent_hash,
                fid: response.cast.parent_author.fid
              }
            }
          : {}),
        timestamp: new Date(response.cast.timestamp)
      }

      this.cache.set(`farcaster/cast/${castHash}`, cast)

      return cast
    } catch (err) {
      if (isApiErrorResponse(err)) {
        ayaLogger.error('Neynar error: ', err.response.data)
        throw err.response.data
      } else {
        ayaLogger.error('Error: ', err)
        throw err
      }
    }
  }

  async getCastsByFid(request: FidRequest): Promise<Cast[]> {
    const timeline: Cast[] = []

    const response = await this.neynar.fetchCastsForUser({
      fid: request.fid,
      limit: request.pageSize
    })
    response.casts.forEach((cast) => {
      this.cache.set(`farcaster/cast/${cast.hash}`, cast)
      timeline.push({
        hash: cast.hash,
        authorFid: cast.author.fid,
        text: cast.text,
        profile: {
          fid: cast.author.fid,
          name: cast.author.display_name || 'anon',
          username: cast.author.username
        },
        timestamp: new Date(cast.timestamp)
      })
    })

    return timeline
  }

  async getMentions(request: FidRequest): Promise<Cast[]> {
    const neynarMentionsResponse = await this.neynar.fetchAllNotifications({
      fid: request.fid,
      type: ['mentions', 'replies']
    })
    const mentions: Cast[] = []

    neynarMentionsResponse.notifications.forEach((notification) => {
      if (isNull(notification.cast)) {
        throw new Error('Cast not found')
      }
      const cast = {
        hash: notification.cast.hash,
        authorFid: notification.cast.author.fid,
        text: notification.cast.text,
        profile: {
          fid: notification.cast.author.fid,
          name: notification.cast.author.display_name || 'anon',
          username: notification.cast.author.username
        },
        ...(notification.cast.parent_hash
          ? {
              inReplyTo: {
                hash: notification.cast.parent_hash,
                fid: notification.cast.parent_author.fid
              }
            }
          : {}),
        timestamp: new Date(notification.cast.timestamp)
      }
      mentions.push(cast)
      this.cache.set(`farcaster/cast/${cast.hash}`, cast)
    })

    return mentions
  }

  async getProfile(fid: number): Promise<Profile> {
    if (this.cache.has(`farcaster/profile/${fid}`)) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return this.cache.get(`farcaster/profile/${fid}`) as Profile
    }

    const result = await this.neynar.fetchBulkUsers({ fids: [fid] })
    if (!result.users || result.users.length < 1) {
      ayaLogger.error('Error fetching user by fid')

      throw new Error('getProfile ERROR')
    }

    const neynarUserProfile = result.users[0]

    const profile: Profile = {
      fid,
      name: '',
      username: ''
    }

    /*
        const userDataBodyType = {
            1: "pfp",
            2: "name",
            3: "bio",
            5: "url",
            6: "username",
            // 7: "location",
            // 8: "twitter",
            // 9: "github",
        } as const;
        */
    if (isNull(neynarUserProfile.display_name)) {
      throw new Error('Display name not found')
    }

    profile.name = neynarUserProfile.display_name
    profile.username = neynarUserProfile.username
    profile.bio = neynarUserProfile.profile.bio.text
    profile.pfp = neynarUserProfile.pfp_url

    this.cache.set(`farcaster/profile/${fid}`, profile)

    return profile
  }

  async getTimeline(request: FidRequest): Promise<{
    timeline: Cast[]
    nextPageToken?: Uint8Array | undefined
  }> {
    const timeline: Cast[] = []

    const results = await this.getCastsByFid(request)

    for (const cast of results) {
      this.cache.set(`farcaster/cast/${cast.hash}`, cast)
      timeline.push(cast)
    }

    return {
      timeline
      // TODO implement paging
      // nextPageToken: results.nextPageToken,
    }
  }
}
