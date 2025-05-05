import { isNull } from '@/common/functions'
import { IFarcasterManager } from '@/managers/interfaces'
import { CastId } from '@/plugins/farcaster/common/types'
import { FarcasterService } from '@/plugins/farcaster/service'
import { IAgentRuntime } from '@elizaos/core'

export class FarcasterManager implements IFarcasterManager {
  constructor(
    private readonly farcaster: FarcasterService,
    private readonly runtime: IAgentRuntime
  ) {}

  async sendCast(params: { content: string; inReplyTo?: CastId }): Promise<void> {
    const { content, inReplyTo } = params

    const manager = this.farcaster.getManager(this.runtime.agentId)
    if (isNull(manager)) {
      throw new Error('Farcaster manager not found')
    }

    await manager.client.sendCast({
      content: {
        text: content
      },
      inReplyTo
    })
  }
}
