import type { ClientBase } from '@/clients/twitter/base'
import { buildConversationThread, sendTweet, wait } from '@/clients/twitter/utils'
import { hasActions, isNull } from '@/common/functions'
import { IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import {
  composeContext,
  type Content,
  generateMessageResponse,
  generateShouldRespond,
  getEmbeddingZeroVector,
  type HandlerCallback,
  type IImageDescriptionService,
  type Memory,
  messageCompletionFooter,
  ModelClass,
  ServiceType,
  shouldRespondFooter,
  stringToUuid
} from '@elizaos/core'
import { SearchMode, type Tweet } from 'agent-twitter-client'

export const twitterMessageHandlerTemplate =
  `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

{{recentPosts}}

# TASK: Generate a post/reply in the voice, style and perspective of {{agentName}} 
(@{{twitterUserName}}) while using the thread of tweets as additional context:

Current Post:
{{currentPost}}
Here is the descriptions of images in the Current post.
{{imageDescriptions}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

# INSTRUCTIONS: Generate a post in the voice, style and perspective of {{agentName}} 
(@{{twitterUserName}}). You MUST include an action if the current post text includes a prompt that 
is similar to one of the available actions mentioned here:
{{actionNames}}
{{actions}}

Here is the current post text again. Remember to include an action if the current post text 
includes a prompt that asks for one of the available actions mentioned above 
(does not need to be exact)
{{currentPost}}
Here is the descriptions of images in the Current post.
{{imageDescriptions}}
` + messageCompletionFooter

export const twitterShouldRespondTemplate = (targetUsersStr: string): string =>
  `# INSTRUCTIONS: Determine if {{agentName}} (@{{twitterUserName}}) should respond to the message
 and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP.

PRIORITY RULE: ALWAYS RESPOND to these users regardless of topic or message content: 
${targetUsersStr}. Topic relevance should be ignored for these users.

For other users:
- {{agentName}} should RESPOND to messages directed at them
- {{agentName}} should RESPOND to conversations relevant to their background
- {{agentName}} should IGNORE irrelevant messages
- {{agentName}} should IGNORE very short messages unless directly addressed
- {{agentName}} should STOP if asked to stop
- {{agentName}} should STOP if conversation is concluded
- {{agentName}} is in a room with other users and wants to be conversational, but not annoying.

IMPORTANT:
- {{agentName}} (aka @{{twitterUserName}}) is particularly sensitive about being annoying, 
so if there is any doubt, it is better to IGNORE than to RESPOND.
- For users not in the priority list, {{agentName}} (@{{twitterUserName}}) should err on 
the side of IGNORE rather than RESPOND if in doubt.

Recent Posts:
{{recentPosts}}

Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

# INSTRUCTIONS: Respond with [RESPOND] if {{agentName}} should respond, or [IGNORE] 
if {{agentName}} should not respond to the last message and [STOP] if {{agentName}} 
should stop participating in the conversation.
` + shouldRespondFooter

export class TwitterInteractionClient {
  client: ClientBase
  runtime: IAyaRuntime

  private isDryRun: boolean

  constructor(client: ClientBase, runtime: IAyaRuntime) {
    this.client = client
    this.runtime = runtime
    this.isDryRun = this.client.twitterConfig.TWITTER_DRY_RUN
  }

  async start(): Promise<void> {
    const handleTwitterInteractionsLoop = (): void => {
      void this.handleTwitterInteractions()
      setTimeout(
        handleTwitterInteractionsLoop,
        // Defaults to 2 minutes
        this.client.twitterConfig.TWITTER_POLL_INTERVAL * 1000
      )
    }
    handleTwitterInteractionsLoop()
  }

  async handleTwitterInteractions(): Promise<void> {
    ayaLogger.info('Checking Twitter interactions')

    const twitterUsername = this.client.profile?.username
    if (isNull(twitterUsername)) {
      ayaLogger.error('Twitter username is not set')
      return
    }
    try {
      // Check for mentions
      const mentionCandidates = (
        await this.client.fetchSearchTweets(`@${twitterUsername}`, 20, SearchMode.Latest)
      ).tweets

      ayaLogger.info('Completed checking mentioned tweets:', mentionCandidates.length)
      let uniqueTweetCandidates = [...mentionCandidates]
      // Only process target users if configured
      if (this.client.twitterConfig.TWITTER_TARGET_USERS.length) {
        const TARGET_USERS = this.client.twitterConfig.TWITTER_TARGET_USERS

        ayaLogger.info('Processing target users:', TARGET_USERS)

        if (TARGET_USERS.length > 0) {
          // Create a map to store tweets by user
          const tweetsByUser = new Map<string, Tweet[]>()

          // Fetch tweets from all target users
          for (const username of TARGET_USERS) {
            try {
              const userTweets = (
                await this.client.twitterClient.fetchSearchTweets(
                  `from:${username}`,
                  3,
                  SearchMode.Latest
                )
              ).tweets

              // Filter for unprocessed, non-reply, recent tweets
              const validTweets = userTweets.filter((tweet) => {
                const isUnprocessed =
                  !this.client.lastCheckedTweetId ||
                  (tweet.id && Number.parseInt(tweet.id) > this.client.lastCheckedTweetId)
                const isRecent = tweet.timestamp
                  ? Date.now() - tweet.timestamp * 1000 < 2 * 60 * 60 * 1000
                  : false

                ayaLogger.info(`Tweet ${tweet.id} checks:`, {
                  isUnprocessed,
                  isRecent,
                  isReply: tweet.isReply,
                  isRetweet: tweet.isRetweet
                })

                return isUnprocessed && !tweet.isReply && !tweet.isRetweet && isRecent
              })

              if (validTweets.length > 0) {
                tweetsByUser.set(username, validTweets)
                ayaLogger.info(`Found ${validTweets.length} valid tweets from ${username}`)
              }
            } catch (error) {
              ayaLogger.error(`Error fetching tweets for ${username}:`, error)
              continue
            }
          }

          // Select one tweet from each user that has tweets
          const selectedTweets: Tweet[] = []
          for (const [username, tweets] of tweetsByUser) {
            if (tweets.length > 0) {
              // Randomly select one tweet from this user
              const randomTweet = tweets[Math.floor(Math.random() * tweets.length)]
              selectedTweets.push(randomTweet)
              ayaLogger.info(
                `Selected tweet from ${username}: ${randomTweet.text?.substring(0, 100)}`
              )
            }
          }

          // Add selected tweets to candidates
          uniqueTweetCandidates = [...mentionCandidates, ...selectedTweets]
        }
      } else {
        ayaLogger.info('No target users configured, processing only mentions')
      }

      // Sort tweet candidates by ID in ascending order
      uniqueTweetCandidates
        .sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))
        .filter((tweet) => tweet.userId !== this.client.profile?.id)

      // for each tweet candidate, handle the tweet
      for (const tweet of uniqueTweetCandidates) {
        if (isNull(tweet.id)) {
          ayaLogger.error('Tweet ID is not set', tweet)
          continue
        }

        if (!this.client.lastCheckedTweetId || BigInt(tweet.id) > this.client.lastCheckedTweetId) {
          // Generate the tweetId UUID the same way it's done in handleTweet
          const tweetId = stringToUuid(tweet.id + '-' + this.runtime.agentId)

          // Check if we've already processed this tweet
          const existingResponse = await this.runtime.messageManager.getMemoryById(tweetId)

          if (existingResponse) {
            ayaLogger.info(`Already responded to tweet ${tweet.id}, skipping`)
            continue
          }
          ayaLogger.info('New Tweet found', tweet.permanentUrl)

          const roomId = stringToUuid(tweet.conversationId + '-' + this.runtime.agentId)

          const userIdUUID =
            tweet.userId === this.client.profile?.id
              ? this.runtime.agentId
              : stringToUuid(tweet.userId ?? '')

          const username = tweet.username
          await this.runtime.ensureUserRoomConnection({
            roomId,
            userId: userIdUUID,
            username,
            name: tweet.name,
            email: username,
            source: 'twitter'
          })

          const thread = await buildConversationThread(tweet, this.client)

          const message = {
            content: {
              text: tweet.text ?? '',
              imageUrls: tweet.photos?.map((photo) => photo.url) || []
            },
            agentId: this.runtime.agentId,
            userId: userIdUUID,
            roomId
          }

          await this.handleTweet({
            tweet,
            message,
            thread
          })

          // Update the last checked tweet ID after processing each tweet
          this.client.lastCheckedTweetId = BigInt(tweet.id)
        }
      }

      // Save the latest checked tweet ID to the file
      await this.client.cacheLatestCheckedTweetId()

      ayaLogger.info('Finished checking Twitter interactions')
    } catch (error) {
      ayaLogger.error('Error handling Twitter interactions:', error)
    }
  }

  private async handleTweet({
    tweet,
    message,
    thread
  }: {
    tweet: Tweet
    message: Memory
    thread: Tweet[]
  }): Promise<{ text: string; action: string }> {
    // Only skip if tweet is from self AND not from a target user
    if (
      tweet.userId === this.client.profile?.id &&
      tweet.username &&
      !this.client.twitterConfig.TWITTER_TARGET_USERS.includes(tweet.username)
    ) {
      return { text: '', action: 'IGNORE' }
    }

    if (!message.content.text) {
      ayaLogger.info('Skipping Tweet with no text', tweet.id)
      return { text: '', action: 'IGNORE' }
    }

    ayaLogger.info('Processing Tweet: ', tweet.id)
    const formatTweet = (tweet: Tweet): string => {
      return `ID: ${tweet.id} From: ${tweet.name} (@${tweet.username})
              Text: ${tweet.text}`
    }
    const currentPost = formatTweet(tweet)

    const formattedConversation = thread
      .map(
        (tweet) => `@${tweet.username} (${
          tweet.timestamp
            ? new Date(tweet.timestamp * 1000).toLocaleString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                month: 'short',
                day: 'numeric'
              })
            : ''
        }):
        ${tweet.text}`
      )
      .join('\n\n')

    const imageDescriptionsArray: { title: string; description: string }[] = []
    try {
      for (const photo of tweet.photos) {
        const description = await this.runtime
          .getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)
          ?.describeImage(photo.url)
        if (description) {
          imageDescriptionsArray.push(description)
        }
      }
    } catch (error) {
      // Handle the error
      ayaLogger.error('Error Occured during describing image: ', error)
      return { text: '', action: 'IGNORE' }
    }

    let state = await this.runtime.composeState(message, {
      twitterClient: this.client.twitterClient,
      twitterUserName: this.client.twitterConfig.TWITTER_USERNAME,
      currentPost,
      formattedConversation,
      imageDescriptions:
        imageDescriptionsArray.length > 0
          ? `\nImages in Tweet:\n${imageDescriptionsArray
              .map(
                (desc: { title: string; description: string }, i: number) =>
                  `Image ${i + 1}: Title: ${desc.title}\nDescription: ${desc.description}`
              )
              .join('\n\n')}`
          : ''
    })

    // check if the tweet exists, save if it doesn't
    const tweetId = stringToUuid(tweet.id + '-' + this.runtime.agentId)
    const tweetExists = await this.runtime.messageManager.getMemoryById(tweetId)

    if (!tweetExists) {
      if (isNull(tweet.userId) || isNull(tweet.conversationId)) {
        ayaLogger.error('Tweet user ID or conversation ID is not set', tweet)
        return { text: '', action: 'IGNORE' }
      }
      ayaLogger.info('tweet does not exist, saving')
      const userIdUUID = stringToUuid(tweet.userId)
      const roomId = stringToUuid(tweet.conversationId)

      const message = {
        id: tweetId,
        agentId: this.runtime.agentId,
        content: {
          text: tweet.text ?? '',
          url: tweet.permanentUrl,
          imageUrls: tweet.photos?.map((photo) => photo.url) || [],
          inReplyTo: tweet.inReplyToStatusId
            ? stringToUuid(tweet.inReplyToStatusId + '-' + this.runtime.agentId)
            : undefined
        },
        userId: userIdUUID,
        roomId,
        createdAt: tweet.timestamp ? tweet.timestamp * 1000 : Date.now()
      }
      void this.client.saveRequestMessage(message, state)
    }

    // get usernames into str
    const validTargetUsersStr = this.client.twitterConfig.TWITTER_TARGET_USERS.join(',')

    const shouldRespondContext = composeContext({
      state,
      template:
        this.runtime.character.templates?.twitterShouldRespondTemplate ||
        this.runtime.character?.templates?.shouldRespondTemplate ||
        twitterShouldRespondTemplate(validTargetUsersStr)
    })

    const shouldRespond = await generateShouldRespond({
      runtime: this.runtime,
      context: shouldRespondContext,
      modelClass: ModelClass.MEDIUM
    })

    // Promise<"RESPOND" | "IGNORE" | "STOP" | null> {
    if (shouldRespond !== 'RESPOND') {
      ayaLogger.info('Not responding to message')
      return { text: 'Response Decision:', action: shouldRespond ?? 'IGNORE' }
    }

    const context = composeContext({
      state: {
        ...state,
        // Convert actionNames array to string
        actionNames: Array.isArray(state.actionNames)
          ? state.actionNames.join(', ')
          : state.actionNames || '',
        actions: Array.isArray(state.actions) ? state.actions.join('\n') : state.actions || '',
        // Ensure character examples are included
        characterPostExamples: this.runtime.character.messageExamples
          ? this.runtime.character.messageExamples
              .map((example) =>
                example
                  .map(
                    (msg) =>
                      `${msg.user}: ${msg.content.text}${msg.content.action ? ` [Action: ${msg.content.action}]` : ''}`
                  )
                  .join('\n')
              )
              .join('\n\n')
          : ''
      },
      template:
        this.runtime.character.templates?.twitterMessageHandlerTemplate ||
        this.runtime.character?.templates?.messageHandlerTemplate ||
        twitterMessageHandlerTemplate
    })

    let shouldContinue = await this.runtime.handle('pre:llm', {
      state,
      responses: [],
      memory: message
    })

    if (!shouldContinue) {
      ayaLogger.info('TwitterClient received pre:llm event but it was suppressed')
      return { text: '', action: 'IGNORE' }
    }

    const response = await generateMessageResponse({
      runtime: this.runtime,
      context,
      modelClass: ModelClass.LARGE
    })

    const responseContent = await this.runtime.validateResponse({
      context,
      response,
      requestText: message.content.text
    })
    const responseText = responseContent?.text
    if (isNull(responseText)) {
      return { text: '', action: 'IGNORE' }
    } else {
      response.text = responseText
      response.action = responseContent?.action
    }

    const removeQuotes = (str: string): string => str.replace(/^['"](.*)['"]$/, '$1')

    const stringId = stringToUuid(tweet.id + '-' + this.runtime.agentId)

    response.inReplyTo = stringId

    response.text = removeQuotes(response.text)

    shouldContinue = await this.runtime.handle('post:llm', {
      state,
      responses: [],
      memory: message,
      content: response
    })

    if (!shouldContinue) {
      ayaLogger.info('TwitterClient received post:llm event but it was suppressed')
      return { text: '', action: 'IGNORE' }
    }

    if (response.text) {
      if (this.isDryRun) {
        ayaLogger.info(
          `Dry run: Selected Post: ${tweet.id} - ${tweet.username}: 
          ${tweet.text}\nAgent's Output:\n${response.text}`
        )
      } else {
        try {
          const callback: HandlerCallback = async (response: Content, tweetId?: string) => {
            if (isNull(tweet.id)) {
              throw new Error('Tweet ID is not set')
            }
            const memories = await sendTweet(
              this.client,
              response,
              message.roomId,
              this.client.twitterConfig.TWITTER_USERNAME,
              tweetId || tweet.id
            )
            return memories
          }

          // Check if the initial message should be suppressed based on action
          const action = this.runtime.actions.find((a) => a.name === response.action)
          const shouldSuppressInitialMessage = action?.suppressInitialMessage === true

          let messageResponses: Memory[] = []

          if (shouldSuppressInitialMessage) {
            ayaLogger.info(
              'Twitter response is suppressed due to suppressInitialMessage action flag',
              response.action
            )
          } else {
            messageResponses = await callback(response)
          }

          state = await this.runtime.updateRecentMessageState(state)

          if (!shouldSuppressInitialMessage) {
            for (const responseMessage of messageResponses) {
              if (responseMessage === messageResponses[messageResponses.length - 1]) {
                responseMessage.content.action = response.action
              } else {
                responseMessage.content.action = 'CONTINUE'
              }
              await this.runtime.messageManager.createMemory(responseMessage)
            }
          }

          const responseTweetId =
            messageResponses.length > 0
              ? messageResponses[messageResponses.length - 1]?.content?.tweetId
              : undefined

          if (!hasActions(messageResponses)) {
            return { text: '', action: 'IGNORE' }
          }

          // `preaction` event
          shouldContinue = await this.runtime.handle('pre:action', {
            state,
            responses: messageResponses,
            memory: message
          })

          if (!shouldContinue) {
            ayaLogger.info('TwitterClient received preaction event but it was suppressed')
            return { text: '', action: 'IGNORE' }
          }

          await this.runtime.processActions(
            message,
            messageResponses,
            state,
            async (response: Content) => {
              shouldContinue = await this.runtime.handle('post:action', {
                state,
                responses: messageResponses,
                memory: message,
                content: response
              })

              if (!shouldContinue) {
                ayaLogger.info('TwitterClient received postaction event but it was suppressed')
                return []
              }

              return callback(response, responseTweetId)
            }
          )

          const responseInfo = `Context:\n\n${context}\n\n
          Selected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\n
          Agent's Output:\n${response.text}`

          await this.runtime.cacheManager.set(
            `twitter/tweet_generation_${tweet.id}.txt`,
            responseInfo
          )
          await wait()
        } catch (error) {
          ayaLogger.error(`Error sending response tweet: ${error}`)
        }
      }
    }

    return { text: '', action: 'IGNORE' }
  }

  async buildConversationThread(tweet: Tweet, maxReplies = 10): Promise<Tweet[]> {
    const thread: Tweet[] = []
    const visited: Set<string> = new Set()

    const processThread = async (currentTweet: Tweet, depth = 0): Promise<void> => {
      ayaLogger.info('Processing tweet:', {
        id: currentTweet.id,
        inReplyToStatusId: currentTweet.inReplyToStatusId,
        depth
      })

      if (!currentTweet) {
        ayaLogger.info('No current tweet found for thread building')
        return
      }

      if (depth >= maxReplies) {
        ayaLogger.info('Reached maximum reply depth', depth)
        return
      }

      // Handle memory storage
      const memory = await this.runtime.messageManager.getMemoryById(
        stringToUuid(currentTweet.id + '-' + this.runtime.agentId)
      )
      if (!memory) {
        if (isNull(currentTweet.userId) || isNull(currentTweet.conversationId)) {
          ayaLogger.error('Tweet user ID or conversation ID is not set', currentTweet)
          return
        }
        const roomId = stringToUuid(currentTweet.conversationId + '-' + this.runtime.agentId)
        const userId = stringToUuid(currentTweet.userId)

        await this.runtime.ensureConnection(
          userId,
          roomId,
          currentTweet.username,
          currentTweet.name,
          'twitter'
        )

        await this.runtime.messageManager.createMemory({
          id: stringToUuid(currentTweet.id + '-' + this.runtime.agentId),
          agentId: this.runtime.agentId,
          content: {
            text: currentTweet.text ?? '',
            source: 'twitter',
            url: currentTweet.permanentUrl,
            imageUrls: currentTweet.photos?.map((photo) => photo.url) || [],
            inReplyTo: currentTweet.inReplyToStatusId
              ? stringToUuid(currentTweet.inReplyToStatusId + '-' + this.runtime.agentId)
              : undefined
          },
          createdAt: currentTweet.timestamp ? currentTweet.timestamp * 1000 : Date.now(),
          roomId,
          userId:
            currentTweet.userId === this.client.profile?.id
              ? this.runtime.agentId
              : stringToUuid(currentTweet.userId),
          embedding: getEmbeddingZeroVector()
        })
      }

      if (isNull(currentTweet.id)) {
        ayaLogger.error('Tweet ID is not set', currentTweet)
        return
      }

      if (visited.has(currentTweet.id)) {
        ayaLogger.info('Already visited tweet:', currentTweet.id)
        return
      }

      visited.add(currentTweet.id)
      thread.unshift(currentTweet)

      if (currentTweet.inReplyToStatusId) {
        ayaLogger.info('Fetching parent tweet:', currentTweet.inReplyToStatusId)
        try {
          const parentTweet = await this.client.getTweet(currentTweet.inReplyToStatusId)

          if (parentTweet) {
            ayaLogger.info('Found parent tweet:', {
              id: parentTweet.id,
              text: parentTweet.text?.slice(0, 50)
            })
            await processThread(parentTweet, depth + 1)
          } else {
            ayaLogger.info('No parent tweet found for:', currentTweet.inReplyToStatusId)
          }
        } catch (error) {
          ayaLogger.info('Error fetching parent tweet:', {
            tweetId: currentTweet.inReplyToStatusId,
            error
          })
        }
      } else {
        ayaLogger.info('Reached end of reply chain at:', currentTweet.id)
      }
    }

    // Need to bind this context for the inner function
    await processThread.bind(this)(tweet, 0)

    return thread
  }
}
