import type { ClientBase } from '@/clients/twitter/base'
import { buildConversationThread, sendTweet, wait } from '@/clients/twitter/utils'
import { isNull } from '@/common/functions'
import { IAyaRuntime } from '@/common/iruntime'
import { ayaLogger } from '@/common/logger'
import {
  composeContext,
  type Content,
  generateMessageResponse,
  generateText,
  type HandlerCallback,
  type IImageDescriptionService,
  messageCompletionFooter,
  ModelClass,
  ServiceType,
  stringToUuid
} from '@elizaos/core'
import { SearchMode } from 'agent-twitter-client'

const twitterSearchTemplate =
  `{{timeline}}

{{providers}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{postDirections}}

{{recentPosts}}

# Task: Respond to the following post in the style and perspective of {{agentName}} 
(aka @{{twitterUserName}}). Write a {{adjective}} response for {{agentName}} to say 
directly in response to the post. don't generalize.
{{currentPost}}

IMPORTANT: Your response CANNOT be longer than 20 words.
Aim for 1-2 short sentences maximum. Be concise and direct.

Your response should not contain any questions. Brief, concise statements only. 
No emojis. Use \\n\\n (double spaces) between statements.

` + messageCompletionFooter

export class TwitterSearchClient {
  client: ClientBase
  runtime: IAyaRuntime
  twitterUsername: string
  private respondedTweets: Set<string> = new Set()

  constructor(client: ClientBase, runtime: IAyaRuntime) {
    this.client = client
    this.runtime = runtime
    this.twitterUsername = this.client.twitterConfig.TWITTER_USERNAME
  }

  async start(): Promise<void> {
    this.engageWithSearchTermsLoop()
  }

  private engageWithSearchTermsLoop(): void {
    void this.engageWithSearchTerms()
    const randomMinutes = Math.floor(Math.random() * (120 - 60 + 1)) + 60
    ayaLogger.info(`Next twitter search scheduled in ${randomMinutes} minutes`)
    setTimeout(() => this.engageWithSearchTermsLoop(), randomMinutes * 60 * 1000)
  }

  private async engageWithSearchTerms(): Promise<void> {
    ayaLogger.info('Engaging with search terms')
    try {
      const searchTerm = [...this.runtime.character.topics][
        Math.floor(Math.random() * this.runtime.character.topics.length)
      ]

      ayaLogger.info('Fetching search tweets')
      // TODO: we wait 5 seconds here to avoid getting rate limited on startup, but we should queue
      await new Promise((resolve) => setTimeout(resolve, 5000))
      const recentTweets = await this.client.fetchSearchTweets(searchTerm, 20, SearchMode.Top)
      ayaLogger.info('Search tweets fetched')

      const homeTimeline = await this.client.fetchHomeTimeline(50)

      await this.client.cacheTimeline(homeTimeline)

      const formattedHomeTimeline =
        `# ${this.runtime.character.name}'s Home Timeline\n\n` +
        homeTimeline
          .map((tweet) => {
            return `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ''}\nText: ${tweet.text}\n---\n`
          })
          .join('\n')

      // randomly slice .tweets down to 20
      const slicedTweets = recentTweets.tweets.sort(() => Math.random() - 0.5).slice(0, 20)

      if (slicedTweets.length === 0) {
        ayaLogger.info('No valid tweets found for the search term', searchTerm)
        return
      }

      const prompt = `
  Here are some tweets related to the search term "${searchTerm}":

  ${[...slicedTweets, ...homeTimeline]
    .filter((tweet) => {
      // ignore tweets where any of the thread tweets contain a tweet by the bot
      const thread = tweet.thread
      const botTweet = thread.find((t) => t.username === this.twitterUsername)
      return !botTweet
    })
    .map(
      (tweet) => `
    ID: ${tweet.id}${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ''}
    From: ${tweet.name} (@${tweet.username})
    Text: ${tweet.text}
  `
    )
    .join('\n')}

  Which tweet is the most interesting and relevant for Ruby to reply to? 
  Please provide only the ID of the tweet in your response.
  Notes:
    - Respond to English tweets only
    - Respond to tweets that don't have a lot of hashtags, links, URLs or images
    - Respond to tweets that are not retweets
    - Respond to tweets where there is an easy exchange of ideas to have with the user
    - ONLY respond with the ID of the tweet`

      const mostInterestingTweetResponse = await generateText({
        runtime: this.runtime,
        context: prompt,
        modelClass: ModelClass.SMALL
      })

      const tweetId = mostInterestingTweetResponse.trim()
      const selectedTweet = slicedTweets.find(
        (tweet) =>
          tweet.id?.toString().includes(tweetId) || tweetId.includes(tweet.id?.toString() ?? '')
      )

      if (!selectedTweet) {
        ayaLogger.warn('No matching tweet found for the selected ID')
        ayaLogger.info('Selected tweet ID:', tweetId)
        return
      }

      ayaLogger.info('Selected tweet to reply to:', selectedTweet?.text)

      if (selectedTweet.username === this.twitterUsername) {
        ayaLogger.info('Skipping tweet from bot itself')
        return
      }

      const conversationId = selectedTweet.conversationId
      const roomId = stringToUuid(conversationId + '-' + this.runtime.agentId)

      const userIdUUID = stringToUuid(selectedTweet.userId ?? '')

      await this.runtime.ensureConnection(
        userIdUUID,
        roomId,
        selectedTweet.username,
        selectedTweet.name,
        'twitter'
      )

      // crawl additional conversation tweets, if there are any
      await buildConversationThread(selectedTweet, this.client)

      const message = {
        id: stringToUuid(selectedTweet.id + '-' + this.runtime.agentId),
        agentId: this.runtime.agentId,
        content: {
          text: selectedTweet.text ?? '',
          url: selectedTweet.permanentUrl,
          inReplyTo: selectedTweet.inReplyToStatusId
            ? stringToUuid(selectedTweet.inReplyToStatusId + '-' + this.runtime.agentId)
            : undefined
        },
        userId: userIdUUID,
        roomId,
        // Timestamps are in seconds, but we need them in milliseconds
        createdAt: selectedTweet.timestamp ? selectedTweet.timestamp * 1000 : Date.now()
      }

      if (!message.content.text) {
        ayaLogger.warn('Returning: No response text found')
        return
      }

      // Fetch replies and retweets
      const replies = selectedTweet.thread
      const replyContext = replies
        .filter((reply) => reply.username !== this.twitterUsername)
        .map((reply) => `@${reply.username}: ${reply.text}`)
        .join('\n')

      let tweetBackground = ''
      if (selectedTweet.isRetweet) {
        const originalTweet = await this.client.requestQueue.add(() =>
          this.client.twitterClient.getTweet(selectedTweet.id ?? '')
        )
        tweetBackground = `Retweeting @${originalTweet?.username}: ${originalTweet?.text}`
      }

      // Generate image descriptions using GPT-4 vision API
      const imageDescriptions: { title: string; description: string }[] = []
      for (const photo of selectedTweet.photos) {
        const description = await this.runtime
          .getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)
          ?.describeImage(photo.url)
        if (description) {
          imageDescriptions.push(description)
        }
      }

      let state = await this.runtime.composeState(message, {
        twitterClient: this.client.twitterClient,
        twitterUserName: this.twitterUsername,
        timeline: formattedHomeTimeline,
        tweetContext: `${tweetBackground}

  Original Post:
  By @${selectedTweet.username}
  ${selectedTweet.text}${replyContext.length > 0 && `\nReplies to original post:\n${replyContext}`}
  ${`Original post text: ${selectedTweet.text}`}
  ${selectedTweet.urls.length > 0 ? `URLs: ${selectedTweet.urls.join(', ')}\n` : ''}${imageDescriptions.length > 0 ? `\nImages in Post (Described): ${imageDescriptions.join(', ')}\n` : ''}
  `
      })

      await this.client.saveRequestMessage(message, state)

      const context = composeContext({
        state,
        template: this.runtime.character.templates?.twitterSearchTemplate || twitterSearchTemplate
      })

      const responseContent = await generateMessageResponse({
        runtime: this.runtime,
        context,
        modelClass: ModelClass.LARGE
      })

      const validatedResponse = await this.runtime.validateResponse({
        context,
        response: responseContent,
        requestText: message.content.text
      })
      const responseText = validatedResponse?.text
      if (isNull(responseText)) {
        return
      } else {
        responseContent.text = responseText
        responseContent.action = validatedResponse?.action
      }

      responseContent.inReplyTo = message.id

      const response = responseContent

      if (!response.text) {
        ayaLogger.warn('Returning: No response text found')
        return
      }

      ayaLogger.info(`Bot would respond to tweet ${selectedTweet.id} with: ${response.text}`)
      try {
        const callback: HandlerCallback = async (response: Content) => {
          if (isNull(selectedTweet.id)) {
            throw new Error('Tweet ID is not set')
          }

          const memories = await sendTweet(
            this.client,
            response,
            message.roomId,
            this.twitterUsername,
            selectedTweet.id
          )
          return memories
        }

        const responseMessages = await callback(responseContent)

        state = await this.runtime.updateRecentMessageState(state)

        for (const responseMessage of responseMessages) {
          await this.runtime.messageManager.createMemory(responseMessage, false)
        }

        state = await this.runtime.updateRecentMessageState(state)

        // await this.runtime.evaluate(message, state)

        await this.runtime.processActions(message, responseMessages, state, callback)

        if (isNull(selectedTweet.id)) {
          throw new Error('Tweet ID is not set')
        }

        this.respondedTweets.add(selectedTweet.id)
        const responseInfo = `Context:\n\n${context}\n\nSelected Post: 
        ${selectedTweet.id} - ${selectedTweet.username}: ${selectedTweet.text}\n
        Agent's Output:\n${response.text}`

        await this.runtime.cacheManager.set(
          `twitter/tweet_generation_${selectedTweet.id}.txt`,
          responseInfo
        )

        await wait()
      } catch (error) {
        console.error(`Error sending response post: ${error}`)
      }
    } catch (error) {
      console.error('Error engaging with search terms:', error)
    }
  }
}
