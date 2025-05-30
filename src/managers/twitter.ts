import { isNull } from '@/common/functions'
import { ITwitterManager } from '@/managers/interfaces'
import { PostTweetRequest, PostTweetResponse } from '@/plugins/twitter/client'
import { TwitterService } from '@/plugins/twitter/service'
import { IAgentRuntime } from '@elizaos/core'

export class TwitterManager implements ITwitterManager {
  private readonly twitterManager: import('@/plugins/twitter/client').TwitterManager

  constructor(twitter: TwitterService, runtime: IAgentRuntime) {
    const manager = twitter.getManager(runtime.agentId)
    if (isNull(manager)) {
      throw new Error('Twitter manager not found')
    }

    this.twitterManager = manager
  }

  async postTweet(params: PostTweetRequest): Promise<PostTweetResponse> {
    return await this.twitterManager.postTweet(params)
  }
}
