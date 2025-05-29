import { AGENTCOIN_FUN_API_URL } from '@/common/env'
import { TWITTER_SOURCE } from '@/plugins/twitter/constants'
import { elizaLogger, IAgentRuntime } from '@elizaos/core'
import { TwitterApi } from 'twitter-api-v2'
import { z } from 'zod'

const PostTweetRequestSchema = z.object({
  text: z.string().min(1).max(280),
  media: z.array(z.string()).optional()
})

export type PostTweetRequest = z.infer<typeof PostTweetRequestSchema>

export interface PostTweetResponse {
  id: string
  text: string
}

const TokenRefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string()
})

export class TwitterManager {
  runtime: IAgentRuntime
  private client: TwitterApi
  private refreshToken_: string

  constructor(runtime: IAgentRuntime, client: TwitterApi, refreshToken: string) {
    this.runtime = runtime
    this.client = client
    this.refreshToken_ = refreshToken
  }

  async start(): Promise<void> {
    elizaLogger.info('Twitter client started')

    try {
      await this.refreshToken()

      // Verify credentials by getting user info
      const user = await this.client.v2.me()
      elizaLogger.info(`Twitter client authenticated for user: @${user.data.username}`)
    } catch (error) {
      elizaLogger.error('Failed to authenticate Twitter client:', error)
      throw error
    }

    elizaLogger.info('✅ Twitter client started')
  }

  private async refreshToken(): Promise<void> {
    try {
      elizaLogger.info(`[${TWITTER_SOURCE}] Refreshing Twitter access token`)

      const refreshUrl = `${AGENTCOIN_FUN_API_URL}/api/x/refresh`
      const response = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refreshToken: this.refreshToken_
        })
      })

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`)
      }

      const responseData = await response.json()
      const { accessToken, refreshToken } = TokenRefreshResponseSchema.parse(responseData)

      this.client = new TwitterApi(accessToken)
      this.refreshToken_ = refreshToken
      elizaLogger.info(`[${TWITTER_SOURCE}] Token refreshed successfully`)
    } catch (error) {
      elizaLogger.error(`[${TWITTER_SOURCE}] Failed to refresh token:`, error)
      throw error
    }
  }

  async postTweet(request: PostTweetRequest): Promise<PostTweetResponse> {
    try {
      const validatedRequest = PostTweetRequestSchema.parse(request)

      // Refresh token before posting
      await this.refreshToken()

      elizaLogger.info(`[${TWITTER_SOURCE}] Posting tweet: ${validatedRequest.text}`)

      const mediaIds: string[] = []

      // Upload media if provided
      if (validatedRequest.media && validatedRequest.media.length > 0) {
        elizaLogger.info(
          `[${TWITTER_SOURCE}] Uploading ${validatedRequest.media.length} media files`
        )

        for (const mediaUrl of validatedRequest.media) {
          try {
            // For now, assume media URLs are accessible and download them
            const response = await fetch(mediaUrl)
            if (!response.ok) {
              throw new Error(`Failed to fetch media: ${response.statusText}`)
            }

            const buffer = await response.arrayBuffer()
            const mediaUpload = await this.client.v1.uploadMedia(Buffer.from(buffer), {
              mimeType: response.headers.get('content-type') || 'image/jpeg'
            })

            mediaIds.push(mediaUpload)
            elizaLogger.info(`[${TWITTER_SOURCE}] Media uploaded with ID: ${mediaUpload}`)
          } catch (mediaError) {
            elizaLogger.error(`[${TWITTER_SOURCE}] Failed to upload media ${mediaUrl}:`, mediaError)
            // Continue with other media files
          }
        }
      }

      // Post the tweet with proper media_ids type
      const tweetPayload: {
        text: string
        media?: {
          media_ids:
            | [string]
            | [string, string]
            | [string, string, string]
            | [string, string, string, string]
        }
      } = {
        text: validatedRequest.text
      }

      if (mediaIds.length > 0) {
        // Ensure we have the right tuple type
        const limitedMediaIds = mediaIds.slice(0, 4)
        if (limitedMediaIds.length === 1) {
          tweetPayload.media = { media_ids: [limitedMediaIds[0]] }
        } else if (limitedMediaIds.length === 2) {
          tweetPayload.media = { media_ids: [limitedMediaIds[0], limitedMediaIds[1]] }
        } else if (limitedMediaIds.length === 3) {
          tweetPayload.media = {
            media_ids: [limitedMediaIds[0], limitedMediaIds[1], limitedMediaIds[2]]
          }
        } else if (limitedMediaIds.length === 4) {
          tweetPayload.media = {
            media_ids: [
              limitedMediaIds[0],
              limitedMediaIds[1],
              limitedMediaIds[2],
              limitedMediaIds[3]
            ]
          }
        }
      }

      const tweet = await this.client.v2.tweet(tweetPayload)

      const response: PostTweetResponse = {
        id: tweet.data.id,
        text: tweet.data.text
      }

      elizaLogger.info(`[${TWITTER_SOURCE}] Tweet posted successfully with ID: ${tweet.data.id}`)

      return response
    } catch (error) {
      elizaLogger.error(`[${TWITTER_SOURCE}] Failed to post tweet:`, error)
      throw error
    }
  }

  async stop(): Promise<void> {
    elizaLogger.info('Twitter client stopped')
  }
}
