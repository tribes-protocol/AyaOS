import { isNull } from '@/common/functions'
import { IFarcasterManager } from '@/managers/interfaces'
import { CastId } from '@/plugins/farcaster/common/types'
import { FarcasterAgentManager } from '@/plugins/farcaster/managers/agent'
import { FarcasterService } from '@/plugins/farcaster/service'
import { IAgentRuntime } from '@elizaos/core'
import { CastWithInteractions } from '@neynar/nodejs-sdk/build/api'

export class FarcasterManager implements IFarcasterManager {
  private readonly farcasterAgentManager: FarcasterAgentManager

  constructor(farcaster: FarcasterService, runtime: IAgentRuntime) {
    const manager = farcaster.getManager(runtime.agentId)
    if (isNull(manager)) {
      throw new Error('Farcaster manager not found')
    }

    this.farcasterAgentManager = manager
  }

  async sendCast(params: {
    text: string
    url?: string
    inReplyTo?: CastId
  }): Promise<CastWithInteractions[]> {
    const { text, url, inReplyTo } = params

    return await this.farcasterAgentManager.client.sendCast({
      content: {
        text,
        url
      },
      inReplyTo
    })
  }

  async getCast(params: { hash: string }): Promise<CastWithInteractions> {
    const { hash } = params

    const cast = await this.farcasterAgentManager.client.getCast(hash)
    return cast
  }
}
