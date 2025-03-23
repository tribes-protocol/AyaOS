import type { ClientBase } from '@/clients/twitter/base'
import { DEFAULT_MAX_TWEET_LENGTH } from '@/clients/twitter/environment'
import { twitterMessageHandlerTemplate } from '@/clients/twitter/interactions'
import { MediaData, RawTweetType } from '@/clients/twitter/types'
import { buildConversationThread, fetchMediaData } from '@/clients/twitter/utils'
import { isNull } from '@/common/functions'
import { IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import {
  ActionResponse,
  cleanJsonResponse,
  composeContext,
  extractAttributes,
  generateText,
  generateTweetActions,
  getEmbeddingZeroVector,
  type IImageDescriptionService,
  ModelClass,
  parseJSONObjectFromText,
  postActionResponseFooter,
  ServiceType,
  State,
  stringToUuid,
  type TemplateType,
  truncateToCompleteSentence,
  type UUID
} from '@elizaos/core'
import type { Tweet } from 'agent-twitter-client'
import { Client, Events, GatewayIntentBits, Partials, TextChannel } from 'discord.js'

const MAX_TIMELINES_TO_FETCH = 15

const twitterPostTemplate = `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

# Task: Generate a post in the voice, style and perspective of {{agentName}} @{{twitterUserName}}.
Write a post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), 
from the perspective of {{agentName}}. Do not add commentary or acknowledge this request, 
just write the post.
Your response should be 1, 2, or 3 sentences (choose the length at random).
Your response should not contain any questions. Brief, concise statements only. The total character
 count MUST be less than {{maxTweetLength}}. No emojis. Use \\n\\n (double spaces) 
 between statements if there are multiple statements in your response.`

export const twitterActionTemplate =
  `
# INSTRUCTIONS: Determine actions for {{agentName}} (@{{twitterUserName}}) based on:
{{bio}}
{{postDirections}}

Guidelines:
- ONLY engage with content that DIRECTLY relates to character's core interests
- Direct mentions are priority IF they are on-topic
- Skip ALL content that is:
  - Off-topic or tangentially related
  - From high-profile accounts unless explicitly relevant
  - Generic/viral content without specific relevance
  - Political/controversial unless central to character
  - Promotional/marketing unless directly relevant

Actions (respond only with tags):
[LIKE] - Perfect topic match AND aligns with character (9.8/10)
[RETWEET] - Exceptional content that embodies character's expertise (9.5/10)
[QUOTE] - Can add substantial domain expertise (9.5/10)
[REPLY] - Can contribute meaningful, expert-level insight (9.5/10)

Tweet:
{{currentTweet}}

# Respond with qualifying action tags only. Default to NO action unless extremely 
confident of relevance.` + postActionResponseFooter

interface PendingTweet {
  tweetTextForPosting: string
  roomId: UUID
  rawTweetContent: string
  discordMessageId: string
  channelId: string
  timestamp: number
}

type PendingTweetApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export class TwitterPostClient {
  client: ClientBase
  runtime: IAyaRuntime
  twitterUsername: string
  private isProcessing = false
  private lastProcessTime = 0
  private stopProcessingActions = false
  private isDryRun: boolean
  private discordClientForApproval: Client | undefined
  private approvalRequired = false
  private discordApprovalChannelId: string | undefined
  private approvalCheckInterval: number | undefined

  constructor(client: ClientBase, runtime: IAyaRuntime) {
    this.client = client
    this.runtime = runtime
    this.twitterUsername = this.client.twitterConfig.TWITTER_USERNAME
    this.isDryRun = this.client.twitterConfig.TWITTER_DRY_RUN

    // Log configuration on initialization
    ayaLogger.log('Twitter Client Configuration:')
    ayaLogger.log(`- Username: ${this.twitterUsername}`)
    ayaLogger.log(`- Dry Run Mode: ${this.isDryRun ? 'enabled' : 'disabled'}`)
    ayaLogger.log(
      // eslint-disable-next-line max-len
      `- Post Interval: ${this.client.twitterConfig.POST_INTERVAL_MIN}-${this.client.twitterConfig.POST_INTERVAL_MAX} minutes`
    )
    ayaLogger.log(
      `- Action Processing: ${
        this.client.twitterConfig.ENABLE_ACTION_PROCESSING ? 'enabled' : 'disabled'
      }`
    )
    ayaLogger.log(`- Action Interval: ${this.client.twitterConfig.ACTION_INTERVAL} minutes`)
    ayaLogger.log(
      `- Post Immediately: ${this.client.twitterConfig.POST_IMMEDIATELY ? 'enabled' : 'disabled'}`
    )
    ayaLogger.log(
      `- Search Enabled: ${
        this.client.twitterConfig.TWITTER_SEARCH_ENABLE ? 'enabled' : 'disabled'
      }`
    )

    const targetUsers = this.client.twitterConfig.TWITTER_TARGET_USERS
    if (targetUsers) {
      ayaLogger.log(`- Target Users: ${targetUsers}`)
    }

    if (this.isDryRun) {
      ayaLogger.log(
        'Twitter client initialized in dry run mode - no actual tweets should be posted'
      )
    }

    // Initialize Discord webhook
    const approvalRequired: boolean =
      this.runtime.getSetting('TWITTER_APPROVAL_ENABLED')?.toLocaleLowerCase() === 'true'

    if (approvalRequired) {
      const discordToken = this.runtime.getSetting('TWITTER_APPROVAL_DISCORD_BOT_TOKEN')
      const approvalChannelId = this.runtime.getSetting('TWITTER_APPROVAL_DISCORD_CHANNEL_ID')

      const optionalInterval = this.runtime.getSetting('TWITTER_APPROVAL_CHECK_INTERVAL')
      const APPROVAL_CHECK_INTERVAL = optionalInterval
        ? Number.parseInt(optionalInterval)
        : 5 * 60 * 1000 // 5 minutes

      this.approvalCheckInterval = APPROVAL_CHECK_INTERVAL

      if (!discordToken || !approvalChannelId) {
        throw new Error(
          'TWITTER_APPROVAL_DISCORD_BOT_TOKEN and TWITTER_APPROVAL_DISCORD_CHANNEL_ID are required for approval workflow'
        )
      }

      this.approvalRequired = true
      this.discordApprovalChannelId = approvalChannelId

      // Set up Discord client event handlers
      this.setupDiscordClient()
    }
  }

  private setupDiscordClient(): void {
    this.discordClientForApproval = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
      ],
      partials: [Partials.Channel, Partials.Message, Partials.Reaction]
    })
    this.discordClientForApproval.once(Events.ClientReady, (readyClient) => {
      ayaLogger.log(`Discord bot is ready as ${readyClient.user.tag}!`)

      // Generate invite link with required permissions
      // eslint-disable-next-line max-len
      const invite = `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user.id}&permissions=274877991936&scope=bot`
      // 274877991936 includes permissions for:
      // - Send Messages
      // - Read Messages/View Channels
      // - Read Message History

      ayaLogger.log(
        `Use this link to properly invite the Twitter Post Approval Discord bot: ${invite}`
      )
    })
    // Login to Discord
    void this.discordClientForApproval.login(
      this.runtime.ensureSetting(
        'TWITTER_APPROVAL_DISCORD_BOT_TOKEN',
        'TWITTER_APPROVAL_DISCORD_BOT_TOKEN is not set'
      )
    )
  }

  async start(): Promise<void> {
    if (!this.client.profile) {
      await this.client.init()
    }

    const generateNewTweetLoop = async (): Promise<void> => {
      const lastPost = await this.runtime.cacheManager.get<{
        timestamp: number
      }>('twitter/' + this.twitterUsername + '/lastPost')

      const lastPostTimestamp = lastPost?.timestamp ?? 0
      const minMinutes = this.client.twitterConfig.POST_INTERVAL_MIN
      const maxMinutes = this.client.twitterConfig.POST_INTERVAL_MAX
      const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes
      const delay = randomMinutes * 60 * 1000

      if (Date.now() > lastPostTimestamp + delay) {
        await this.generateNewTweet()
      }

      setTimeout(() => {
        void generateNewTweetLoop() // Set up next iteration
      }, delay)

      ayaLogger.log(`Next tweet scheduled in ${randomMinutes} minutes`)
    }

    const processActionsLoop = async (): Promise<void> => {
      const actionInterval = this.client.twitterConfig.ACTION_INTERVAL // Defaults to 5 minutes

      while (!this.stopProcessingActions) {
        try {
          const results = await this.processTweetActions()
          if (results) {
            ayaLogger.log(`Processed ${results.length} tweets`)
            ayaLogger.log(`Next action processing scheduled in ${actionInterval} minutes`)
            // Wait for the full interval before next processing
            await new Promise(
              (resolve) => setTimeout(resolve, actionInterval * 60 * 1000) // now in minutes
            )
          }
        } catch (error) {
          ayaLogger.error('Error in action processing loop:', error)
          // Add exponential backoff on error
          await new Promise((resolve) => setTimeout(resolve, 30000)) // Wait 30s on error
        }
      }
    }

    if (this.client.twitterConfig.POST_IMMEDIATELY) {
      await this.generateNewTweet()
    }

    void generateNewTweetLoop()
    ayaLogger.log('Tweet generation loop started')

    if (this.client.twitterConfig.ENABLE_ACTION_PROCESSING) {
      processActionsLoop().catch((error) => {
        ayaLogger.error('Fatal error in process actions loop:', error)
      })
    }

    // Start the pending tweet check loop if enabled
    if (this.approvalRequired) this.runPendingTweetCheckLoop()
  }

  private runPendingTweetCheckLoop(): void {
    setInterval(async () => {
      await this.handlePendingTweet()
    }, this.approvalCheckInterval)
  }

  createTweetObject(tweetResult: RawTweetType, client: ClientBase, twitterUsername: string): Tweet {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return {
      id: tweetResult.rest_id,
      name: client.profile?.screenName,
      username: client.profile?.username,
      text: tweetResult.legacy?.full_text,
      conversationId: tweetResult.legacy?.conversation_id_str,
      createdAt: tweetResult.legacy?.created_at ?? undefined,
      timestamp: tweetResult.legacy?.created_at
        ? new Date(tweetResult.legacy?.created_at).getTime()
        : undefined,
      userId: client.profile?.id,
      inReplyToStatusId: tweetResult.legacy?.in_reply_to_status_id_str,
      permanentUrl: `https://twitter.com/${twitterUsername}/status/${tweetResult.rest_id}`,
      hashtags: [],
      mentions: [],
      photos: [],
      thread: [],
      urls: [],
      videos: []
    } as Tweet
  }

  async processAndCacheTweet(
    runtime: IAyaRuntime,
    client: ClientBase,
    tweet: Tweet,
    roomId: UUID,
    rawTweetContent: string
  ): Promise<void> {
    // Cache the last post details
    await runtime.cacheManager.set(`twitter/${client.profile?.username}/lastPost`, {
      id: tweet.id,
      timestamp: Date.now()
    })

    // Cache the tweet
    await client.cacheTweet(tweet)

    // Log the posted tweet
    ayaLogger.log(`Tweet posted:\n ${tweet.permanentUrl}`)

    // Ensure the room and participant exist
    await runtime.ensureRoomExists(roomId)
    await runtime.ensureParticipantInRoom(runtime.agentId, roomId)

    // Create a memory for the tweet
    await runtime.messageManager.createMemory({
      id: stringToUuid(tweet.id + '-' + runtime.agentId),
      userId: runtime.agentId,
      agentId: runtime.agentId,
      content: {
        text: rawTweetContent.trim(),
        url: tweet.permanentUrl,
        source: 'twitter'
      },
      roomId,
      embedding: getEmbeddingZeroVector(),
      createdAt: tweet.timestamp
    })
  }

  async handleNoteTweet(
    client: ClientBase,
    content: string,
    tweetId?: string,
    mediaData?: MediaData[]
  ): Promise<Tweet | null> {
    try {
      const noteTweetResult: {
        errors: {
          message: string
        }[]
        data: {
          notetweet_create: {
            tweet_results: {
              result: Tweet
            }
          }
        }
      } = await client.requestQueue.add(
        async () => await client.twitterClient.sendNoteTweet(content, tweetId, mediaData)
      )

      if (noteTweetResult.errors && noteTweetResult.errors.length > 0) {
        // Note Tweet failed due to authorization. Falling back to standard Tweet.
        const truncateContent = truncateToCompleteSentence(
          content,
          this.client.twitterConfig.MAX_TWEET_LENGTH
        )
        return await this.sendStandardTweet(client, truncateContent, tweetId)
      } else {
        return noteTweetResult.data.notetweet_create.tweet_results.result
      }
    } catch (error) {
      throw new Error(`Note Tweet failed: ${error}`)
    }
  }

  async sendStandardTweet(
    client: ClientBase,
    content: string,
    tweetId?: string,
    mediaData?: MediaData[]
  ): Promise<Tweet | null> {
    try {
      const standardTweetResult = await client.requestQueue.add(
        async () => await client.twitterClient.sendTweet(content, tweetId, mediaData)
      )
      const body: {
        data: {
          create_tweet: {
            tweet_results: {
              result: Tweet
            }
          }
        }
      } = await standardTweetResult.json()
      if (!body?.data?.create_tweet?.tweet_results?.result) {
        ayaLogger.error('Error sending tweet; Bad response:', body)
        return null
      }
      return body.data.create_tweet.tweet_results.result
    } catch (error) {
      ayaLogger.error('Error sending standard Tweet:', error)
      throw error
    }
  }

  async postTweet(
    runtime: IAyaRuntime,
    client: ClientBase,
    tweetTextForPosting: string,
    roomId: UUID,
    rawTweetContent: string,
    twitterUsername: string,
    mediaData?: MediaData[]
  ): Promise<Tweet | null> {
    try {
      ayaLogger.log(`Posting new tweet:\n`)

      let result

      if (tweetTextForPosting.length > DEFAULT_MAX_TWEET_LENGTH) {
        result = await this.handleNoteTweet(client, tweetTextForPosting, undefined, mediaData)
      } else {
        result = await this.sendStandardTweet(client, tweetTextForPosting, undefined, mediaData)
      }

      const tweet = this.createTweetObject(result, client, twitterUsername)

      await this.processAndCacheTweet(runtime, client, tweet, roomId, rawTweetContent)

      return tweet
    } catch (error) {
      ayaLogger.error('Error sending tweet:', error)
      return null
    }
  }

  /**
   * Generates and posts a new tweet. If isDryRun is true, only logs what would have been posted.
   */
  async generateNewTweet(): Promise<void> {
    ayaLogger.log('Generating new tweet')

    try {
      if (isNull(this.client.profile)) {
        ayaLogger.error('Client profile is not set')
        return
      }

      const roomId = stringToUuid('user_twitter_feed:' + this.client.profile.username)

      await this.runtime.ensureUserRoomConnection({
        roomId,
        userId: this.runtime.agentId,
        username: this.client.profile.username,
        name: this.client.profile.username,
        source: 'twitter'
      })

      const topics = this.runtime.character.topics.join(', ')
      const maxTweetLength = this.client.twitterConfig.MAX_TWEET_LENGTH
      const state = await this.runtime.composeState(
        {
          userId: this.runtime.agentId,
          roomId,
          agentId: this.runtime.agentId,
          content: {
            text: topics || '',
            action: 'TWEET'
          }
        },
        {
          twitterUserName: this.client.profile.username,
          maxTweetLength
        }
      )

      let shouldContinue = await this.runtime.handle('pre:llm', {
        state,
        responses: [],
        memory: undefined
      })

      if (!shouldContinue) {
        ayaLogger.info('AgentcoinClient received prellm event but it was suppressed')
        return
      }

      const context = composeContext({
        state,
        template: this.runtime.character.templates?.twitterPostTemplate || twitterPostTemplate
      })

      ayaLogger.debug('generate post prompt:\n' + context)

      const response = await generateText({
        runtime: this.runtime,
        context,
        modelClass: ModelClass.SMALL
      })

      shouldContinue = await this.runtime.handle('post:llm', {
        state,
        responses: [],
        memory: undefined,
        content: { text: response }
      })

      if (!shouldContinue) {
        ayaLogger.info('AgentcoinClient received postllm event but it was suppressed')
        return
      }

      const rawTweetContent = cleanJsonResponse(response)

      // First attempt to clean content
      let tweetTextForPosting: string | null = null
      let mediaData: MediaData[] | null = null

      // Try parsing as JSON first
      const parsedResponse = parseJSONObjectFromText(rawTweetContent)
      if (parsedResponse?.text) {
        tweetTextForPosting = parsedResponse.text
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (parsedResponse?.attachments && parsedResponse?.attachments.length > 0) {
        mediaData = await fetchMediaData(parsedResponse.attachments)
      }

      // Try extracting text attribute
      if (!tweetTextForPosting) {
        const parsingText = extractAttributes(rawTweetContent, ['text']).text
        if (parsingText) {
          tweetTextForPosting = truncateToCompleteSentence(
            extractAttributes(rawTweetContent, ['text'])?.text ?? '',
            this.client.twitterConfig.MAX_TWEET_LENGTH
          )
        }
      }

      // Use the raw text
      if (!tweetTextForPosting) {
        tweetTextForPosting = rawTweetContent
      }

      if (maxTweetLength) {
        tweetTextForPosting = truncateToCompleteSentence(tweetTextForPosting, maxTweetLength)
      }

      const removeQuotes = (str: string): string => str.replace(/^['"](.*)['"]$/, '$1')

      const fixNewLines = (str: string): string => str.replaceAll(/\\n/g, '\n\n') // ensures double spaces

      // Final cleaning
      tweetTextForPosting = removeQuotes(fixNewLines(tweetTextForPosting))

      if (this.isDryRun) {
        ayaLogger.info(`Dry run: would have posted tweet: ${tweetTextForPosting}`)
        return
      }

      try {
        if (this.approvalRequired) {
          // Send for approval instead of posting directly
          ayaLogger.log(`Sending Tweet For Approval:\n ${tweetTextForPosting}`)
          await this.sendForApproval(tweetTextForPosting, roomId, rawTweetContent)
          ayaLogger.log('Tweet sent for approval')
        } else {
          ayaLogger.log(`Posting new tweet:\n ${tweetTextForPosting}`)
          void this.postTweet(
            this.runtime,
            this.client,
            tweetTextForPosting,
            roomId,
            rawTweetContent,
            this.twitterUsername,
            mediaData ?? undefined
          )
        }
      } catch (error) {
        ayaLogger.error('Error sending tweet:', error)
      }
    } catch (error) {
      ayaLogger.error('Error generating new tweet:', error)
    }
  }

  private async generateTweetContent(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tweetState: any,
    options?: {
      template?: TemplateType
      context?: string
    }
  ): Promise<string> {
    const context = composeContext({
      state: tweetState,
      template:
        options?.template ||
        this.runtime.character.templates?.twitterPostTemplate ||
        twitterPostTemplate
    })

    const response = await generateText({
      runtime: this.runtime,
      context: options?.context || context,
      modelClass: ModelClass.SMALL
    })

    ayaLogger.log('generate tweet content response:\n' + response)

    // First clean up any markdown and newlines
    const cleanedResponse = cleanJsonResponse(response)

    // Try to parse as JSON first
    const jsonResponse = parseJSONObjectFromText(cleanedResponse)
    if (jsonResponse?.text) {
      const truncateContent = truncateToCompleteSentence(
        jsonResponse.text,
        this.client.twitterConfig.MAX_TWEET_LENGTH
      )
      return truncateContent
    }
    if (typeof jsonResponse === 'object') {
      const possibleContent =
        jsonResponse?.content || jsonResponse?.message || jsonResponse?.response
      if (possibleContent) {
        const truncateContent = truncateToCompleteSentence(
          possibleContent,
          this.client.twitterConfig.MAX_TWEET_LENGTH
        )
        return truncateContent
      }
    }

    let truncateContent: string | null = null
    // Try extracting text attribute
    const parsingText = extractAttributes(cleanedResponse, ['text'])?.text ?? ''
    if (parsingText) {
      truncateContent = truncateToCompleteSentence(
        parsingText,
        this.client.twitterConfig.MAX_TWEET_LENGTH
      )
    }

    if (!truncateContent) {
      // If not JSON or no valid content found, clean the raw text
      truncateContent = truncateToCompleteSentence(
        cleanedResponse,
        this.client.twitterConfig.MAX_TWEET_LENGTH
      )
    }

    return truncateContent
  }

  /**
   * Processes tweet actions (likes, retweets, quotes, replies). If isDryRun is true,
   * only simulates and logs actions without making API calls.
   */
  private async processTweetActions(): Promise<
    {
      tweetId: string
      actionResponse: ActionResponse
      executedActions: string[]
    }[]
  > {
    if (this.isProcessing) {
      ayaLogger.log('Already processing tweet actions, skipping')
      return []
    }

    try {
      this.isProcessing = true
      this.lastProcessTime = Date.now()

      ayaLogger.log('Processing tweet actions')

      await this.runtime.ensureUserExists(
        this.runtime.agentId,
        this.twitterUsername,
        this.runtime.character.name,
        'twitter'
      )

      const timelines = await this.client.fetchTimelineForActions(MAX_TIMELINES_TO_FETCH)
      const maxActionsProcessing = this.client.twitterConfig.MAX_ACTIONS_PROCESSING
      const processedTimelines: {
        tweet: Tweet
        actionResponse: ActionResponse
        tweetState: State
        roomId: UUID
      }[] = []

      for (const tweet of timelines) {
        try {
          // Skip if we've already processed this tweet
          const memory = await this.runtime.messageManager.getMemoryById(
            stringToUuid(tweet.id + '-' + this.runtime.agentId)
          )
          if (memory) {
            ayaLogger.log(`Already processed tweet ID: ${tweet.id}`)
            continue
          }

          const roomId = stringToUuid(tweet.conversationId + '-' + this.runtime.agentId)

          const tweetState = await this.runtime.composeState(
            {
              userId: this.runtime.agentId,
              roomId,
              agentId: this.runtime.agentId,
              content: { text: '', action: '' }
            },
            {
              twitterUserName: this.twitterUsername,
              currentTweet: `ID: ${tweet.id}\nFrom: ${tweet.name} 
              (@${tweet.username})\nText: ${tweet.text}`
            }
          )

          const actionContext = composeContext({
            state: tweetState,
            template:
              this.runtime.character.templates?.twitterActionTemplate || twitterActionTemplate
          })

          const actionResponse = await generateTweetActions({
            runtime: this.runtime,
            context: actionContext,
            modelClass: ModelClass.SMALL
          })

          if (!actionResponse) {
            ayaLogger.log(`No valid actions generated for tweet ${tweet.id}`)
            continue
          }
          processedTimelines.push({
            tweet,
            actionResponse,
            tweetState,
            roomId
          })
        } catch (error) {
          ayaLogger.error(`Error processing tweet ${tweet.id}:`, error)
          continue
        }
      }

      const sortProcessedTimeline = (arr: typeof processedTimelines): typeof processedTimelines => {
        return arr.sort((a, b) => {
          // Count the number of true values in the actionResponse object
          const countTrue = (obj: typeof a.actionResponse): number =>
            Object.values(obj).filter(Boolean).length

          const countA = countTrue(a.actionResponse)
          const countB = countTrue(b.actionResponse)

          // Primary sort by number of true values
          if (countA !== countB) {
            return countB - countA
          }

          // Secondary sort by the "like" property
          if (a.actionResponse.like !== b.actionResponse.like) {
            return a.actionResponse.like ? -1 : 1
          }

          // Tertiary sort keeps the remaining objects with equal weight
          return 0
        })
      }
      // Sort the timeline based on the action decision score,
      const sortedTimelines = sortProcessedTimeline(processedTimelines).slice(
        0,
        maxActionsProcessing
      )

      return this.processTimelineActions(sortedTimelines)
    } catch (error) {
      ayaLogger.error('Error in processTweetActions:', error)
      throw error
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Processes a list of timelines by executing the corresponding tweet actions.
   * Each timeline includes the tweet, action response, tweet state, and room context.
   * Results are returned for tracking completed actions.
   *
   * @param timelines - Array of objects containing tweet details, action responses, and
   * state information.
   * @returns A promise that resolves to an array of results with details of executed actions.
   */
  private async processTimelineActions(
    timelines: {
      tweet: Tweet
      actionResponse: ActionResponse
      tweetState: State
      roomId: UUID
    }[]
  ): Promise<
    {
      tweetId: string
      actionResponse: ActionResponse
      executedActions: string[]
    }[]
  > {
    const results: {
      tweetId: string
      actionResponse: ActionResponse
      executedActions: string[]
    }[] = []
    for (const timeline of timelines) {
      const { actionResponse, tweetState, roomId, tweet } = timeline
      const tweetId = tweet.id
      if (isNull(tweetId)) {
        ayaLogger.error('Tweet ID is not set')
        continue
      }
      try {
        const executedActions: string[] = []
        // Execute actions
        if (actionResponse.like) {
          if (this.isDryRun) {
            ayaLogger.info(`Dry run: would have liked tweet ${tweetId}`)
            executedActions.push('like (dry run)')
          } else {
            try {
              await this.client.twitterClient.likeTweet(tweetId)
              executedActions.push('like')
              ayaLogger.log(`Liked tweet ${tweetId}`)
            } catch (error) {
              ayaLogger.error(`Error liking tweet ${tweetId}:`, error)
            }
          }
        }

        if (actionResponse.retweet) {
          if (this.isDryRun) {
            ayaLogger.info(`Dry run: would have retweeted tweet ${tweetId}`)
            executedActions.push('retweet (dry run)')
          } else {
            try {
              await this.client.twitterClient.retweet(tweetId)
              executedActions.push('retweet')
              ayaLogger.log(`Retweeted tweet ${tweetId}`)
            } catch (error) {
              ayaLogger.error(`Error retweeting tweet ${tweetId}:`, error)
            }
          }
        }

        if (actionResponse.quote) {
          try {
            // Build conversation thread for context
            const thread = await buildConversationThread(tweet, this.client)
            const formattedConversation = thread
              .map(
                (t) =>
                  `@${t.username} (${t.timestamp ? new Date(t.timestamp * 1000).toLocaleString() : ''}): ${t.text}`
              )
              .join('\n\n')

            // Generate image descriptions if present
            const imageDescriptions: { title: string; description: string }[] = []
            if (tweet.photos?.length > 0) {
              ayaLogger.log('Processing images in tweet for context')
              for (const photo of tweet.photos) {
                const description = await this.runtime
                  .getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)
                  ?.describeImage(photo.url)
                if (description) {
                  imageDescriptions.push(description)
                }
              }
            }

            // Handle quoted tweet if present
            let quotedContent = ''
            if (tweet.quotedStatusId) {
              try {
                const quotedTweet = await this.client.twitterClient.getTweet(tweet.quotedStatusId)
                if (quotedTweet) {
                  quotedContent = `\nQuoted Tweet from
                   @${quotedTweet.username}:\n${quotedTweet.text}`
                }
              } catch (error) {
                ayaLogger.error('Error fetching quoted tweet:', error)
              }
            }

            // Compose rich state with all context
            const enrichedState = await this.runtime.composeState(
              {
                userId: this.runtime.agentId,
                roomId: stringToUuid(tweet.conversationId + '-' + this.runtime.agentId),
                agentId: this.runtime.agentId,
                content: {
                  text: tweet.text ?? '',
                  action: 'QUOTE'
                }
              },
              {
                twitterUserName: this.twitterUsername,
                currentPost: `From @${tweet.username}: ${tweet.text}`,
                formattedConversation,
                imageContext:
                  imageDescriptions.length > 0
                    ? `\nImages in Tweet:\n${imageDescriptions
                        .map((desc, i) => `Image ${i + 1}: ${desc}`)
                        .join('\n')}`
                    : '',
                quotedContent
              }
            )

            const quoteContent = await this.generateTweetContent(enrichedState, {
              template:
                this.runtime.character.templates?.twitterMessageHandlerTemplate ||
                twitterMessageHandlerTemplate
            })

            if (!quoteContent) {
              ayaLogger.error('Failed to generate valid quote tweet content')
              return []
            }

            ayaLogger.log('Generated quote tweet content:', quoteContent)
            // Check for dry run mode
            if (this.isDryRun) {
              ayaLogger.info(
                `Dry run: A quote tweet for tweet ID ${tweet.id} 
                would have been posted with the following content: "${quoteContent}".`
              )
              executedActions.push('quote (dry run)')
            } else {
              // Send the tweet through request queue
              const result = await this.client.requestQueue.add(
                async () => await this.client.twitterClient.sendQuoteTweet(quoteContent, tweetId)
              )

              const body: {
                data: {
                  create_tweet: {
                    tweet_results: {
                      result: Tweet
                    }
                  }
                }
              } = await result.json()
              if (body?.data?.create_tweet?.tweet_results?.result) {
                ayaLogger.log('Successfully posted quote tweet')
                executedActions.push('quote')

                // Cache generation context for debugging
                await this.runtime.cacheManager.set(
                  `twitter/quote_generation_${tweet.id}.txt`,
                  `Context:\n${enrichedState}\n\nGenerated Quote:\n${quoteContent}`
                )
              } else {
                ayaLogger.error('Quote tweet creation failed:', body)
              }
            }
          } catch (error) {
            ayaLogger.error('Error in quote tweet generation:', error)
          }
        }

        if (actionResponse.reply) {
          try {
            await this.handleTextOnlyReply(tweet, tweetState, executedActions)
          } catch (error) {
            ayaLogger.error(`Error replying to tweet ${tweet.id}:`, error)
          }
        }

        // Add these checks before creating memory
        await this.runtime.ensureRoomExists(roomId)
        await this.runtime.ensureUserExists(
          stringToUuid(tweet.userId ?? ''),
          tweet.username ?? null,
          tweet.name ?? null,
          'twitter'
        )
        await this.runtime.ensureParticipantInRoom(this.runtime.agentId, roomId)

        if (!this.isDryRun) {
          // Then create the memory
          await this.runtime.messageManager.createMemory({
            id: stringToUuid(tweet.id + '-' + this.runtime.agentId),
            userId: stringToUuid(tweet.userId ?? ''),
            content: {
              text: tweet.text ?? '',
              url: tweet.permanentUrl,
              source: 'twitter',
              action: executedActions.join(',')
            },
            agentId: this.runtime.agentId,
            roomId,
            embedding: getEmbeddingZeroVector(),
            createdAt: tweet.timestamp ? tweet.timestamp * 1000 : Date.now()
          })
        }

        results.push({
          tweetId: tweetId ?? '',
          actionResponse,
          executedActions
        })
      } catch (error) {
        ayaLogger.error(`Error processing tweet ${tweet.id}:`, error)
        continue
      }
    }

    return results
  }

  /**
   * Handles text-only replies to tweets. If isDryRun is true, only logs what would
   * have been replied without making API calls.
   */
  private async handleTextOnlyReply(
    tweet: Tweet,
    tweetState: unknown,
    executedActions: string[]
  ): Promise<void> {
    try {
      // Build conversation thread for context
      const thread = await buildConversationThread(tweet, this.client)
      const formattedConversation = thread
        .map(
          (t) =>
            `@${t.username} (${t.timestamp ? new Date(t.timestamp * 1000).toLocaleString() : ''}): ${t.text}`
        )
        .join('\n\n')

      // Generate image descriptions if present
      const imageDescriptions: { title: string; description: string }[] = []
      if (tweet.photos?.length > 0) {
        ayaLogger.log('Processing images in tweet for context')
        for (const photo of tweet.photos) {
          const description = await this.runtime
            .getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)
            ?.describeImage(photo.url)
          if (description) {
            imageDescriptions.push(description)
          }
        }
      }

      // Handle quoted tweet if present
      let quotedContent = ''
      if (tweet.quotedStatusId) {
        try {
          const quotedTweet = await this.client.twitterClient.getTweet(tweet.quotedStatusId)
          if (quotedTweet) {
            quotedContent = `\nQuoted Tweet from @${quotedTweet.username}:\n${quotedTweet.text}`
          }
        } catch (error) {
          ayaLogger.error('Error fetching quoted tweet:', error)
        }
      }

      // Compose rich state with all context
      const enrichedState = await this.runtime.composeState(
        {
          userId: this.runtime.agentId,
          roomId: stringToUuid(tweet.conversationId + '-' + this.runtime.agentId),
          agentId: this.runtime.agentId,
          content: { text: tweet.text ?? '', action: '' }
        },
        {
          twitterUserName: this.twitterUsername,
          currentPost: `From @${tweet.username}: ${tweet.text}`,
          formattedConversation,
          imageContext:
            imageDescriptions.length > 0
              ? `\nImages in Tweet:\n${imageDescriptions
                  .map((desc, i) => `Image ${i + 1}: ${desc}`)
                  .join('\n')}`
              : '',
          quotedContent
        }
      )

      // Generate and clean the reply content
      const replyText = await this.generateTweetContent(enrichedState, {
        template:
          this.runtime.character.templates?.twitterMessageHandlerTemplate ||
          twitterMessageHandlerTemplate
      })

      if (!replyText) {
        ayaLogger.error('Failed to generate valid reply content')
        return
      }

      if (this.isDryRun) {
        ayaLogger.info(`Dry run: reply to tweet ${tweet.id} would have been: ${replyText}`)
        executedActions.push('reply (dry run)')
        return
      }

      ayaLogger.debug('Final reply text to be sent:', replyText)

      let result

      if (replyText.length > DEFAULT_MAX_TWEET_LENGTH) {
        result = await this.handleNoteTweet(this.client, replyText, tweet.id)
      } else {
        result = await this.sendStandardTweet(this.client, replyText, tweet.id)
      }

      if (result) {
        ayaLogger.log('Successfully posted reply tweet')
        executedActions.push('reply')

        // Cache generation context for debugging
        await this.runtime.cacheManager.set(
          `twitter/reply_generation_${tweet.id}.txt`,
          `Context:\n${enrichedState}\n\nGenerated Reply:\n${replyText}`
        )
      } else {
        ayaLogger.error('Tweet reply creation failed')
      }
    } catch (error) {
      ayaLogger.error('Error in handleTextOnlyReply:', error)
    }
  }

  async stop(): Promise<void> {
    this.stopProcessingActions = true
  }

  private async sendForApproval(
    tweetTextForPosting: string,
    roomId: UUID,
    rawTweetContent: string
  ): Promise<string | null> {
    try {
      const embed = {
        title: 'New Tweet Pending Approval',
        description: tweetTextForPosting,
        fields: [
          {
            name: 'Character',
            value: this.client.profile?.username ?? '',
            inline: true
          },
          {
            name: 'Length',
            value: tweetTextForPosting.length.toString(),
            inline: true
          }
        ],
        footer: {
          text: "Reply with '👍' to post or '❌' to discard, This will automatically expire and remove after 24 hours if no response received"
        },
        timestamp: new Date().toISOString()
      }

      const channel = await this.discordClientForApproval?.channels.fetch(
        this.discordApprovalChannelId ?? ''
      )

      if (!channel || !(channel instanceof TextChannel)) {
        throw new Error('Invalid approval channel')
      }

      const message = await channel.send({ embeds: [embed] })

      // Store the pending tweet
      const pendingTweetsKey = `twitter/${this.client.profile?.username}/pendingTweet`
      const currentPendingTweets =
        (await this.runtime.cacheManager.get<PendingTweet[]>(pendingTweetsKey)) || []
      // Add new pending tweet
      currentPendingTweets.push({
        tweetTextForPosting,
        roomId,
        rawTweetContent,
        discordMessageId: message.id,
        channelId: this.discordApprovalChannelId ?? '',
        timestamp: Date.now()
      })

      // Store updated array
      await this.runtime.cacheManager.set(pendingTweetsKey, currentPendingTweets)

      return message.id
    } catch (error) {
      ayaLogger.error('Error Sending Twitter Post Approval Request:', error)
      return null
    }
  }

  private async checkApprovalStatus(discordMessageId: string): Promise<PendingTweetApprovalStatus> {
    try {
      // Fetch message and its replies from Discord
      const channel = await this.discordClientForApproval?.channels.fetch(
        this.discordApprovalChannelId ?? ''
      )

      ayaLogger.log(`channel ${JSON.stringify(channel)}`)

      if (!(channel instanceof TextChannel)) {
        ayaLogger.error('Invalid approval channel')
        return 'PENDING'
      }

      // Fetch the original message and its replies
      const message = await channel.messages.fetch(discordMessageId)

      // Look for thumbs up reaction ('👍')
      const thumbsUpReaction = message.reactions.cache.find(
        (reaction) => reaction.emoji.name === '👍'
      )

      // Look for reject reaction ('❌')
      const rejectReaction = message.reactions.cache.find(
        (reaction) => reaction.emoji.name === '❌'
      )

      // Check if the reaction exists and has reactions
      if (rejectReaction) {
        const count = rejectReaction.count
        if (count > 0) {
          return 'REJECTED'
        }
      }

      // Check if the reaction exists and has reactions
      if (thumbsUpReaction) {
        // You might want to check for specific users who can approve
        // For now, we'll return true if anyone used thumbs up
        const count = thumbsUpReaction.count
        if (count > 0) {
          return 'APPROVED'
        }
      }

      return 'PENDING'
    } catch (error) {
      ayaLogger.error('Error checking approval status:', error)
      return 'PENDING'
    }
  }

  private async cleanupPendingTweet(discordMessageId: string): Promise<void> {
    const pendingTweetsKey = `twitter/${this.client.profile?.username}/pendingTweet`
    const currentPendingTweets =
      (await this.runtime.cacheManager.get<PendingTweet[]>(pendingTweetsKey)) || []

    // Remove the specific tweet
    const updatedPendingTweets = currentPendingTweets.filter(
      (tweet) => tweet.discordMessageId !== discordMessageId
    )

    if (updatedPendingTweets.length === 0) {
      await this.runtime.cacheManager.delete(pendingTweetsKey)
    } else {
      await this.runtime.cacheManager.set(pendingTweetsKey, updatedPendingTweets)
    }
  }

  private async handlePendingTweet(): Promise<void> {
    ayaLogger.log('Checking Pending Tweets...')
    const pendingTweetsKey = `twitter/${this.client.profile?.username}/pendingTweet`
    const pendingTweets =
      (await this.runtime.cacheManager.get<PendingTweet[]>(pendingTweetsKey)) || []

    for (const pendingTweet of pendingTweets) {
      // Check if tweet is older than 24 hours
      const isExpired = Date.now() - pendingTweet.timestamp > 24 * 60 * 60 * 1000

      if (isExpired) {
        ayaLogger.log('Pending tweet expired, cleaning up')

        // Notify on Discord about expiration
        try {
          const channel = await this.discordClientForApproval?.channels.fetch(
            pendingTweet.channelId
          )
          if (channel instanceof TextChannel) {
            const originalMessage = await channel.messages.fetch(pendingTweet.discordMessageId)
            await originalMessage.reply('This tweet approval request has expired (24h timeout).')
          }
        } catch (error) {
          ayaLogger.error('Error sending expiration notification:', error)
        }

        await this.cleanupPendingTweet(pendingTweet.discordMessageId)
        return
      }

      // Check approval status
      ayaLogger.log('Checking approval status...')
      const approvalStatus: PendingTweetApprovalStatus = await this.checkApprovalStatus(
        pendingTweet.discordMessageId
      )

      if (approvalStatus === 'APPROVED') {
        ayaLogger.log('Tweet Approved, Posting')
        await this.postTweet(
          this.runtime,
          this.client,
          pendingTweet.tweetTextForPosting,
          pendingTweet.roomId,
          pendingTweet.rawTweetContent,
          this.twitterUsername
        )

        // Notify on Discord about posting
        try {
          const channel = await this.discordClientForApproval?.channels.fetch(
            pendingTweet.channelId
          )
          if (channel instanceof TextChannel) {
            const originalMessage = await channel.messages.fetch(pendingTweet.discordMessageId)
            await originalMessage.reply('Tweet has been posted successfully! ✅')
          }
        } catch (error) {
          ayaLogger.error('Error sending post notification:', error)
        }

        await this.cleanupPendingTweet(pendingTweet.discordMessageId)
      } else if (approvalStatus === 'REJECTED') {
        ayaLogger.log('Tweet Rejected, Cleaning Up')
        await this.cleanupPendingTweet(pendingTweet.discordMessageId)
        // Notify about Rejection of Tweet
        try {
          const channel = await this.discordClientForApproval?.channels.fetch(
            pendingTweet.channelId
          )
          if (channel instanceof TextChannel) {
            const originalMessage = await channel.messages.fetch(pendingTweet.discordMessageId)
            await originalMessage.reply('Tweet has been rejected! ❌')
          }
        } catch (error) {
          ayaLogger.error('Error sending rejection notification:', error)
        }
      }
    }
  }
}
