import { isNull } from '@/common/functions'
import { ObjectGenerationParamsWithSchema } from '@/common/types'
import { ILLMService } from '@/services/interfaces'
import { IAgentRuntime, ModelType, Service, TextGenerationParams, UUID } from '@elizaos/core'
import { z } from 'zod'

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

  async generateText(options: TextGenerationParams): Promise<string> {
    const text = await this.runtime.useModel(ModelType.TEXT_LARGE, options)
    return text
  }

  async generateObject<T extends z.ZodSchema>(
    options: Omit<ObjectGenerationParamsWithSchema, 'schema'> & { schema: T }
  ): Promise<z.infer<T>> {
    for (let i = 0; i < 3; i++) {
      try {
        const object = await this.runtime.useModel(ModelType.OBJECT_LARGE, options)
        return options.schema.parse(object)
      } catch (error) {
        if (i === 2) throw error
        console.warn(`Attempt ${i + 1} failed, retrying...`, error)
      }
    }
  }
}
