import { isNull } from '@/common/functions'
import { ILLMService } from '@/services/interfaces'
import { IAgentRuntime, ModelType, Service, TextGenerationParams, UUID } from '@elizaos/core'

export class LLMService extends Service implements ILLMService {
  static readonly instances = new Map<UUID, LLMService>()

  static readonly serviceType = 'aya-os-llm-service'
  readonly capabilityDescription = ''

  static async start(_runtime: IAgentRuntime): Promise<Service> {
    let instance = LLMService.instances.get(_runtime.agentId)
    if (instance) {
      return instance
    }
    instance = new LLMService(_runtime)
    LLMService.instances.set(_runtime.agentId, instance)
    return instance
  }

  static async stop(_runtime: IAgentRuntime): Promise<unknown> {
    const instance = LLMService.instances.get(_runtime.agentId)
    if (isNull(instance)) {
      return undefined
    }
    await instance.stop()
    return instance
  }

  async stop(): Promise<void> {
    // nothing to do
  }

  async generateText(options: Omit<TextGenerationParams, 'runtime' | 'model'>): Promise<string> {
    const text = await this.runtime.useModel(ModelType.TEXT_LARGE, options)
    return text
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const embedding = await this.runtime.useModel(ModelType.TEXT_EMBEDDING, { text })
    return embedding
  }
}
