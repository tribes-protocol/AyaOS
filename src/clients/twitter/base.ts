import type { TwitterConfig } from '@/clients/twitter/environment'
import { RawTweetType, TwitterCookie } from '@/clients/twitter/types'
import { isNull } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import {
  ActionTimelineType,
  type IAgentRuntime,
  type IImageDescriptionService,
  type Memory,
  type State,
  type UUID,
  getEmbeddingZeroVector,
  stringToUuid
} from '@elizaos/core'
import { type QueryTweetsResponse, Scraper, SearchMode, type Tweet } from 'agent-twitter-client'
import { EventEmitter } from 'events'

export function extractAnswer(text: string): string {
  const startIndex = text.indexOf('Answer: ') + 8
  const endIndex = text.indexOf('<|endoftext|>', 11)
  return text.slice(startIndex, endIndex)
}

type TwitterProfile = {
  id: string
  username: string
  screenName: string
  bio: string
  nicknames: string[]
}

class RequestQueue {
  private queue: (() => Promise<unknown>)[] = []
  private processing = false

  async add<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await request()
          resolve(result)
        } catch (error) {
          reject(error)
        }
      })
      void this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return
    }
    this.processing = true

    while (this.queue.length > 0) {
      const request = this.queue.shift()
      if (isNull(request)) {
        return
      }

      try {
        await request()
      } catch (error) {
        console.error('Error processing request:', error)
        this.queue.unshift(request)
        await this.exponentialBackoff(this.queue.length)
      }
      await this.randomDelay()
    }

    this.processing = false
  }

  private async exponentialBackoff(retryCount: number): Promise<void> {
    const delay = Math.pow(2, retryCount) * 1000
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  private async randomDelay(): Promise<void> {
    const delay = Math.floor(Math.random() * 2000) + 1500
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
}

export class ClientBase extends EventEmitter {
  static _twitterClients: { [accountIdentifier: string]: Scraper } = {}
  twitterClient: Scraper
  runtime: IAgentRuntime
  twitterConfig: TwitterConfig
  directions: string
  lastCheckedTweetId: bigint | null = null
  imageDescriptionService: IImageDescriptionService | null = null
  temperature = 0.5

  requestQueue: RequestQueue = new RequestQueue()

  profile: TwitterProfile | null = null

  async cacheTweet(tweet: Tweet): Promise<void> {
    if (!tweet) {
      console.warn('Tweet is undefined, skipping cache')
      return
    }

    await this.runtime.cacheManager.set(`twitter/tweets/${tweet.id}`, tweet)
  }

  async getCachedTweet(tweetId: string): Promise<Tweet | undefined> {
    const cached = await this.runtime.cacheManager.get<Tweet>(`twitter/tweets/${tweetId}`)

    return cached
  }

  async getTweet(tweetId: string): Promise<Tweet | null> {
    const cachedTweet = await this.getCachedTweet(tweetId)

    if (cachedTweet) {
      return cachedTweet
    }

    const tweet = await this.requestQueue.add(() => this.twitterClient.getTweet(tweetId))

    if (tweet) {
      await this.cacheTweet(tweet)
    }

    return tweet
  }

  // eslint-disable-next-line no-use-before-define
  callback: ((self: ClientBase) => Promise<void>) | null = null

  onReady(): void {
    throw new Error('Not implemented in base class, please call from subclass')
  }

  /**
   * Parse the raw tweet data into a standardized Tweet object.
   */
  private parseTweet(raw: RawTweetType, depth = 0, maxDepth = 3): Tweet {
    // If we've reached maxDepth, don't parse nested quotes/retweets further
    const canRecurse = depth < maxDepth

    const quotedStatus =
      raw.quoted_status_result?.result && canRecurse
        ? this.parseTweet(raw.quoted_status_result.result, depth + 1, maxDepth)
        : undefined

    const retweetedStatus =
      raw.retweeted_status_result?.result && canRecurse
        ? this.parseTweet(raw.retweeted_status_result.result, depth + 1, maxDepth)
        : undefined

    const t: Tweet = {
      bookmarkCount: raw.bookmarkCount ?? raw.legacy?.bookmark_count ?? undefined,
      conversationId: raw.conversationId ?? raw.legacy?.conversation_id_str,
      hashtags: raw.hashtags ?? raw.legacy?.entities?.hashtags ?? [],
      html: raw.html,
      id: raw.id ?? raw.rest_id ?? raw.id_str ?? undefined,
      inReplyToStatus: raw.inReplyToStatus,
      inReplyToStatusId:
        raw.inReplyToStatusId ?? raw.legacy?.in_reply_to_status_id_str ?? undefined,
      isQuoted: raw.legacy?.is_quote_status === true,
      isPin: raw.isPin,
      isReply: raw.isReply,
      isRetweet: raw.legacy?.retweeted === true,
      isSelfThread: raw.isSelfThread,
      // language: raw.legacy?.lang,
      likes: raw.legacy?.favorite_count ?? 0,
      name:
        raw.name ??
        raw?.user_results?.result?.legacy?.name ??
        raw.core?.user_results?.result?.legacy?.name,
      mentions: raw.mentions ?? raw.legacy?.entities?.user_mentions ?? [],
      permanentUrl:
        raw.permanentUrl ??
        (raw.core?.user_results?.result?.legacy?.screen_name && raw.rest_id
          ? // eslint-disable-next-line max-len
            `https://x.com/${raw.core?.user_results?.result?.legacy?.screen_name}/status/${raw.rest_id}`
          : undefined),
      photos:
        raw.photos ??
        (raw.legacy?.entities?.media
          ?.filter((media) => media.type === 'photo')
          .map((media) => ({
            id: media.id_str,
            url: media.media_url_https,
            alt_text: media.alt_text
          })) ||
          []),
      place: raw.place,
      poll: raw.poll ?? null,
      quotedStatus,
      quotedStatusId: raw.quotedStatusId ?? raw.legacy?.quoted_status_id_str ?? undefined,
      // quotes: raw.legacy?.quote_count ?? 0,
      replies: raw.legacy?.reply_count ?? 0,
      retweets: raw.legacy?.retweet_count ?? 0,
      retweetedStatus,
      retweetedStatusId: raw.legacy?.retweeted_status_id_str ?? undefined,
      text: raw.text ?? raw.legacy?.full_text ?? undefined,
      thread: raw.thread || [],
      timeParsed: raw.timeParsed
        ? new Date(raw.timeParsed)
        : raw.legacy?.created_at
          ? new Date(raw.legacy?.created_at)
          : undefined,
      timestamp:
        raw.timestamp ??
        (raw.legacy?.created_at ? new Date(raw.legacy.created_at).getTime() / 1000 : undefined),
      urls: raw.urls ?? raw.legacy?.entities?.urls ?? [],
      userId: raw.userId ?? raw.legacy?.user_id_str ?? undefined,
      username: raw.username ?? raw.core?.user_results?.result?.legacy?.screen_name ?? undefined,
      videos: raw.videos ?? [],
      views: raw.views?.count ? Number(raw.views.count) : 0,
      sensitiveContent: raw.sensitiveContent
    }

    return t
  }

  constructor(runtime: IAgentRuntime, twitterConfig: TwitterConfig) {
    super()
    this.runtime = runtime
    this.twitterConfig = twitterConfig
    const username = twitterConfig.TWITTER_USERNAME
    if (ClientBase._twitterClients[username]) {
      this.twitterClient = ClientBase._twitterClients[username]
    } else {
      this.twitterClient = new Scraper()
      ClientBase._twitterClients[username] = this.twitterClient
    }

    this.directions =
      '- ' +
      this.runtime.character.style.all.join('\n- ') +
      '- ' +
      this.runtime.character.style.post.join()
  }

  async init(): Promise<void> {
    const username = this.twitterConfig.TWITTER_USERNAME
    const password = this.twitterConfig.TWITTER_PASSWORD
    const email = this.twitterConfig.TWITTER_EMAIL
    let retries = this.twitterConfig.TWITTER_RETRY_LIMIT
    const twitter2faSecret = this.twitterConfig.TWITTER_2FA_SECRET

    if (!username) {
      throw new Error('Twitter username not configured')
    }

    const cachedCookies = await this.getCachedCookies(username)

    if (cachedCookies) {
      ayaLogger.info('Using cached cookies')
      await this.setCookiesFromArray(cachedCookies)
    }

    ayaLogger.info('Waiting for Twitter login')
    while (retries > 0) {
      try {
        if (await this.twitterClient.isLoggedIn()) {
          // cookies are valid, no login required
          ayaLogger.info('Successfully logged in.')
          break
        } else {
          await this.twitterClient.login(username, password, email, twitter2faSecret)
          if (await this.twitterClient.isLoggedIn()) {
            // fresh login, store new cookies
            ayaLogger.info('Successfully logged in.')
            ayaLogger.info('Caching cookies')
            await this.cacheCookies(username, await this.twitterClient.getCookies())
            break
          }
        }
      } catch (error) {
        if (error instanceof Error) {
          ayaLogger.error(`Login attempt failed: ${error.message}`)
        } else {
          ayaLogger.error(`Login attempt failed: ${error}`)
        }
      }

      retries--
      ayaLogger.error(`Failed to login to Twitter. Retrying... (${retries} attempts left)`)

      if (retries === 0) {
        ayaLogger.error('Max retries reached. Exiting login process.')
        throw new Error('Twitter login failed after maximum retries.')
      }

      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    // Initialize Twitter profile
    this.profile = await this.fetchProfile(username)

    if (this.profile) {
      ayaLogger.info('Twitter user ID:', this.profile.id)
      ayaLogger.info('Twitter loaded:', JSON.stringify(this.profile, null, 10))
      // Store profile info for use in responses
      this.runtime.character.twitterProfile = {
        id: this.profile.id,
        username: this.profile.username,
        screenName: this.profile.screenName,
        bio: this.profile.bio,
        nicknames: this.profile.nicknames
      }
    } else {
      throw new Error('Failed to load profile')
    }

    await this.loadLatestCheckedTweetId()
    await this.populateTimeline()
  }

  async fetchOwnPosts(count: number): Promise<Tweet[]> {
    ayaLogger.debug('fetching own posts')
    if (isNull(this.profile)) {
      throw new Error('Profile is not loaded')
    }
    const homeTimeline = await this.twitterClient.getUserTweets(this.profile.id, count)
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return homeTimeline.tweets.map((t) => this.parseTweet(t as RawTweetType))
  }

  /**
   * Fetch timeline for twitter account, optionally only from followed accounts
   */
  async fetchHomeTimeline(count: number, following?: boolean): Promise<Tweet[]> {
    ayaLogger.debug('fetching home timeline')
    const homeTimeline = following
      ? await this.twitterClient.fetchFollowingTimeline(count, [])
      : await this.twitterClient.fetchHomeTimeline(count, [])

    ayaLogger.debug('Raw home timeline:', homeTimeline)
    const processedTimeline = homeTimeline
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      .filter((t) => t.__typename !== 'TweetWithVisibilityResults') // Filter out visibility-restricted tweets
      .map((tweet) => this.parseTweet(tweet))

    // ayaLogger.debug("process homeTimeline", processedTimeline);
    return processedTimeline
  }

  async fetchTimelineForActions(count: number): Promise<Tweet[]> {
    ayaLogger.debug('fetching timeline for actions')

    const agentUsername = this.twitterConfig.TWITTER_USERNAME

    const homeTimeline =
      this.twitterConfig.ACTION_TIMELINE_TYPE === ActionTimelineType.Following
        ? await this.twitterClient.fetchFollowingTimeline(count, [])
        : await this.twitterClient.fetchHomeTimeline(count, [])

    // Parse, filter out self-tweets, limit to count
    return homeTimeline
      .map((tweet) => this.parseTweet(tweet))
      .filter((tweet) => tweet.username !== agentUsername) // do not perform action on self-tweets
      .slice(0, count)
    // TODO: Once the 'count' parameter is fixed in the 'fetchTimeline'
    // method of the 'agent-twitter-client',
    // this workaround can be removed.
    // Related issue: https://github.com/elizaos/agent-twitter-client/issues/43
  }

  async fetchSearchTweets(
    query: string,
    maxTweets: number,
    searchMode: SearchMode,
    cursor?: string
  ): Promise<QueryTweetsResponse> {
    try {
      // if we dont get a response in 5 seconds, something is wrong
      const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => resolve({ tweets: [] }), 15000)
      )

      try {
        const result = await this.requestQueue.add(
          async () =>
            await Promise.race([
              this.twitterClient.fetchSearchTweets(query, maxTweets, searchMode, cursor),
              timeoutPromise
            ])
        )
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        return (result ?? { tweets: [] }) as QueryTweetsResponse
      } catch (error) {
        ayaLogger.error('Error fetching search tweets:', error)
        return { tweets: [] }
      }
    } catch (error) {
      ayaLogger.error('Error fetching search tweets:', error)
      return { tweets: [] }
    }
  }

  private async populateTimeline(): Promise<void> {
    ayaLogger.debug('populating timeline...')

    const cachedTimeline = await this.getCachedTimeline()

    // Check if the cache file exists
    if (cachedTimeline) {
      // Read the cached search results from the file

      // Get the existing memories from the database
      const existingMemories = await this.runtime.messageManager.getMemoriesByRoomIds({
        roomIds: cachedTimeline.map((tweet) =>
          stringToUuid(tweet.conversationId + '-' + this.runtime.agentId)
        )
      })

      // TODO: load tweets not in cache?

      // Create a Set to store the IDs of existing memories
      const existingMemoryIds = new Set(existingMemories.map((memory) => memory.id?.toString()))

      // Check if any of the cached tweets exist in the existing memories
      const someCachedTweetsExist = cachedTimeline.some((tweet) =>
        existingMemoryIds.has(stringToUuid(tweet.id + '-' + this.runtime.agentId))
      )

      if (someCachedTweetsExist) {
        // Filter out the cached tweets that already exist in the database
        const tweetsToSave = cachedTimeline.filter(
          (tweet) => !existingMemoryIds.has(stringToUuid(tweet.id + '-' + this.runtime.agentId))
        )

        console.log({
          processingTweets: tweetsToSave.map((tweet) => tweet.id).join(',')
        })

        // Save the missing tweets as memories
        for (const tweet of tweetsToSave) {
          ayaLogger.info('Saving Tweet', tweet.id)

          const roomId = stringToUuid(tweet.conversationId + '-' + this.runtime.agentId)

          const userId =
            tweet.userId === this.profile?.id
              ? this.runtime.agentId
              : stringToUuid(tweet.userId ?? '')

          if (tweet.userId === this.profile?.id) {
            await this.runtime.ensureConnection(
              this.runtime.agentId,
              roomId,
              this.profile?.username,
              this.profile?.screenName,
              'twitter'
            )
          } else {
            await this.runtime.ensureConnection(
              userId,
              roomId,
              tweet.username,
              tweet.name,
              'twitter'
            )
          }

          const content = {
            text: tweet.text ?? '',
            url: tweet.permanentUrl,
            source: 'twitter',
            inReplyTo: tweet.inReplyToStatusId
              ? stringToUuid(tweet.inReplyToStatusId + '-' + this.runtime.agentId)
              : undefined
          }

          ayaLogger.info('Creating memory for tweet', tweet.id)

          // check if it already exists
          const memory = await this.runtime.messageManager.getMemoryById(
            stringToUuid(tweet.id + '-' + this.runtime.agentId)
          )

          if (memory) {
            ayaLogger.info('Memory already exists, skipping timeline population')
            break
          }

          await this.runtime.messageManager.createMemory({
            id: stringToUuid(tweet.id + '-' + this.runtime.agentId),
            userId,
            content,
            agentId: this.runtime.agentId,
            roomId,
            embedding: getEmbeddingZeroVector(),
            createdAt: tweet.timestamp ? tweet.timestamp * 1000 : undefined
          })

          await this.cacheTweet(tweet)
        }

        ayaLogger.info(`Populated ${tweetsToSave.length} missing tweets from the cache.`)
        return
      }
    }

    const timeline = await this.fetchHomeTimeline(cachedTimeline ? 10 : 50)
    const username = this.twitterConfig.TWITTER_USERNAME

    // Get the most recent 20 mentions and interactions
    const mentionsAndInteractions = await this.fetchSearchTweets(
      `@${username}`,
      20,
      SearchMode.Latest
    )

    // Combine the timeline tweets and mentions/interactions
    const allTweets = [...timeline, ...mentionsAndInteractions.tweets]

    // Create a Set to store unique tweet IDs
    const tweetIdsToCheck = new Set<string>()
    const roomIds = new Set<UUID>()

    // Add tweet IDs to the Set
    for (const tweet of allTweets) {
      if (isNull(tweet.id)) {
        continue
      }
      tweetIdsToCheck.add(tweet.id)
      roomIds.add(stringToUuid(tweet.conversationId + '-' + this.runtime.agentId))
    }

    // Check the existing memories in the database
    const existingMemories = await this.runtime.messageManager.getMemoriesByRoomIds({
      roomIds: Array.from(roomIds)
    })
    // Create a Set to store the existing memory IDs
    const existingMemoryIds = new Set<UUID>(
      existingMemories.map((memory) => memory.id).filter((id) => !isNull(id))
    )

    // Filter out the tweets that already exist in the database
    const tweetsToSave = allTweets.filter(
      (tweet) => !existingMemoryIds.has(stringToUuid(tweet.id + '-' + this.runtime.agentId))
    )

    ayaLogger.debug({
      processingTweets: tweetsToSave.map((tweet) => tweet.id).join(',')
    })

    await this.runtime.ensureUserExists(
      this.runtime.agentId,
      this.profile?.username ?? null,
      this.runtime.character.name,
      'twitter'
    )

    // Save the new tweets as memories
    for (const tweet of tweetsToSave) {
      ayaLogger.info('Saving Tweet', tweet.id)

      const roomId = stringToUuid(tweet.conversationId + '-' + this.runtime.agentId)
      const userId =
        tweet.userId === this.profile?.id ? this.runtime.agentId : stringToUuid(tweet.userId ?? '')

      if (tweet.userId === this.profile?.id) {
        await this.runtime.ensureConnection(
          this.runtime.agentId,
          roomId,
          this.profile?.username,
          this.profile?.screenName,
          'twitter'
        )
      } else {
        await this.runtime.ensureConnection(userId, roomId, tweet.username, tweet.name, 'twitter')
      }

      const content = {
        text: tweet.text ?? '',
        url: tweet.permanentUrl,
        source: 'twitter',
        inReplyTo: tweet.inReplyToStatusId ? stringToUuid(tweet.inReplyToStatusId) : undefined
      }

      await this.runtime.messageManager.createMemory({
        id: stringToUuid(tweet.id + '-' + this.runtime.agentId),
        userId,
        content,
        agentId: this.runtime.agentId,
        roomId,
        embedding: getEmbeddingZeroVector(),
        createdAt: tweet.timestamp ? tweet.timestamp * 1000 : undefined
      })

      await this.cacheTweet(tweet)
    }

    // Cache
    await this.cacheTimeline(timeline)
    await this.cacheMentions(mentionsAndInteractions.tweets)
  }

  async setCookiesFromArray(cookiesArray: TwitterCookie[]): Promise<void> {
    const cookieStrings = cookiesArray.map(
      (cookie) =>
        `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}; ${
          cookie.secure ? 'Secure' : ''
        }; ${cookie.httpOnly ? 'HttpOnly' : ''}; SameSite=${cookie.sameSite || 'Lax'}`
    )
    await this.twitterClient.setCookies(cookieStrings)
  }

  async saveRequestMessage(message: Memory, _state: State): Promise<void> {
    if (message.content.text) {
      const recentMessage = await this.runtime.messageManager.getMemories({
        roomId: message.roomId,
        count: 1,
        unique: false
      })

      if (recentMessage.length > 0 && recentMessage[0].content === message.content) {
        ayaLogger.debug('Message already saved', recentMessage[0].id)
      } else {
        await this.runtime.messageManager.createMemory({
          ...message,
          embedding: getEmbeddingZeroVector()
        })
      }

      // await this.runtime.evaluate(message, {
      //   ...state,
      //   twitterClient: this.twitterClient
      // })
    }
  }

  async loadLatestCheckedTweetId(): Promise<void> {
    const latestCheckedTweetId = await this.runtime.cacheManager.get<string>(
      `twitter/${this.profile?.username}/latest_checked_tweet_id`
    )

    if (latestCheckedTweetId) {
      this.lastCheckedTweetId = BigInt(latestCheckedTweetId)
    }
  }

  async cacheLatestCheckedTweetId(): Promise<void> {
    if (this.lastCheckedTweetId) {
      await this.runtime.cacheManager.set(
        `twitter/${this.profile?.username}/latest_checked_tweet_id`,
        this.lastCheckedTweetId.toString()
      )
    }
  }

  async getCachedTimeline(): Promise<Tweet[] | undefined> {
    return await this.runtime.cacheManager.get<Tweet[]>(
      `twitter/${this.profile?.username}/timeline`
    )
  }

  async cacheTimeline(timeline: Tweet[]): Promise<void> {
    await this.runtime.cacheManager.set(`twitter/${this.profile?.username}/timeline`, timeline, {
      expires: Date.now() + 10 * 1000
    })
  }

  async cacheMentions(mentions: Tweet[]): Promise<void> {
    await this.runtime.cacheManager.set(`twitter/${this.profile?.username}/mentions`, mentions, {
      expires: Date.now() + 10 * 1000
    })
  }

  async getCachedCookies(username: string): Promise<TwitterCookie[] | undefined> {
    return await this.runtime.cacheManager.get<TwitterCookie[]>(`twitter/${username}/cookies`)
  }

  async cacheCookies(username: string, cookies: TwitterCookie[]): Promise<void> {
    await this.runtime.cacheManager.set(`twitter/${username}/cookies`, cookies)
  }

  async fetchProfile(username: string): Promise<TwitterProfile> {
    try {
      const profile = await this.requestQueue.add(async () => {
        const profile = await this.twitterClient.getProfile(username)
        if (isNull(profile.userId)) {
          throw new Error('Profile ID is not set')
        }
        return {
          id: profile.userId,
          username,
          screenName: profile.name || this.runtime.character.name,
          bio:
            profile.biography ||
            (typeof this.runtime.character.bio === 'string'
              ? this.runtime.character.bio
              : this.runtime.character.bio.length > 0
                ? this.runtime.character.bio[0]
                : ''),
          nicknames: this.runtime.character.twitterProfile?.nicknames || []
        } satisfies TwitterProfile
      })

      return profile
    } catch (error) {
      console.error('Error fetching Twitter profile:', error)
      throw error
    }
  }
}
