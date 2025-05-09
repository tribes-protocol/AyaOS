import { isNull } from '@/common/functions'
import { ObjectGenerationOptions } from '@/common/types'
import { generateObjectByModelType, getLargeModel } from '@/plugins/openai'
import { ILLMService } from '@/services/interfaces'
import { IAgentRuntime, ModelType, Service, TextGenerationParams, UUID } from '@elizaos/core'
import { z } from 'zod'

export class LLMService extends Service implements ILLMService {
  static readonly instances = new Map<UUID, LLMService>()

  static readonly serviceType = 'aya-os-llm-service'
  readonly capabilityDescription = ''

  static async start(runtime: IAgentRuntime): Promise<Service> {
    let instance = LLMService.instances.get(runtime.agentId)
    if (instance) {
      return instance
    }
    instance = new LLMService(runtime)
    LLMService.instances.set(runtime.agentId, instance)
    return instance
  }

  static async stop(runtime: IAgentRuntime): Promise<unknown> {
    const instance = LLMService.instances.get(runtime.agentId)
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

  async generateObject<T extends z.ZodSchema>(
    options: ObjectGenerationOptions<T>
  ): Promise<z.infer<T>> {
    const model = options.model
    const result = await generateObjectByModelType(
      this.runtime,
      {
        ...options,
        schema: undefined,
        runtime: this.runtime
      },
      ModelType.OBJECT_LARGE,
      (runtime: IAgentRuntime) => (isNull(model) ? getLargeModel(runtime) : model)
    )
    return options.schema.parse(result)
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const embedding = await this.runtime.useModel(ModelType.TEXT_EMBEDDING, { text })
    return embedding
  }
}
