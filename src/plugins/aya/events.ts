import { AgentRegistry } from '@/agent/registry'
import { AYA_AGENT_DATA_DIR_KEY } from '@/common/constants'
import { ensureStringSetting, isNull } from '@/common/functions'
import { validateResponse } from '@/common/llms/response-validator'
import {
  asUUID,
  composePromptFromState,
  Content,
  createUniqueUuid,
  EventType,
  logger,
  Memory,
  messageHandlerTemplate,
  MessageReceivedHandlerParams,
  ModelType,
  parseJSONObjectFromText,
  shouldRespondTemplate
} from '@elizaos/core'
import { v4 } from 'uuid'

const latestResponseIds = new Map<string, Map<string, string>>()

/**
 * Handles incoming messages and generates responses based on the provided runtime
 * and message information.
 *
 * @param {MessageReceivedHandlerParams} params - The parameters needed for message handling,
 * including runtime, message, and callback.
 * @returns {Promise<void>} - A promise that resolves once the message handling and response
 * generation is complete.
 */
export const messageReceivedHandler = async ({
  runtime,
  message,
  callback,
  onComplete
}: MessageReceivedHandlerParams): Promise<void> => {
  const messageId = message.id
  if (isNull(messageId)) {
    throw Error(`Message ID is required: ${message}`)
  }

  const dataDir = ensureStringSetting(runtime, AYA_AGENT_DATA_DIR_KEY)
  const { rateLimiter } = AgentRegistry.get(dataDir)

  // Generate a new response ID
  const responseId = v4()
  // Get or create the agent-specific map
  if (!latestResponseIds.has(runtime.agentId)) {
    latestResponseIds.set(runtime.agentId, new Map<string, string>())
  }
  const agentResponses = latestResponseIds.get(runtime.agentId)
  if (!agentResponses) {
    throw new Error('Agent responses map not found')
  }

  // Set this as the latest response ID for this agent+room
  agentResponses.set(message.roomId, responseId)

  // Generate a unique run ID for tracking this message handler execution
  const runId = asUUID(v4())
  const startTime = Date.now()

  // Emit run started event
  await runtime.emitEvent(EventType.RUN_STARTED, {
    runtime,
    runId,
    messageId: message.id,
    roomId: message.roomId,
    entityId: message.entityId,
    startTime,
    status: 'started',
    source: 'messageHandler'
  })

  // Set up timeout monitoring
  const timeoutDuration = 60 * 60 * 1000 // 1 hour
  let timeoutId: NodeJS.Timeout | undefined

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(async () => {
      await runtime.emitEvent(EventType.RUN_TIMEOUT, {
        runtime,
        runId,
        messageId: message.id,
        roomId: message.roomId,
        entityId: message.entityId,
        startTime,
        status: 'timeout',
        endTime: Date.now(),
        duration: Date.now() - startTime,
        error: 'Run exceeded 60 minute timeout',
        source: 'messageHandler'
      })
      reject(new Error('Run exceeded 60 minute timeout'))
    }, timeoutDuration)
  })

  const processingPromise = (async () => {
    try {
      if (message.entityId === runtime.agentId) {
        throw new Error('Message is from the agent itself')
      }

      // First, save the incoming message
      await runtime.addEmbeddingToMemory(message)
      await runtime.createMemory(message, 'messages')

      if (rateLimiter) {
        const canProcess = await rateLimiter.canProcess(message)
        if (!canProcess) {
          logger.warn('Rate limit exceeded, skipping message from user:', message.entityId)
          return
        }
      }

      const agentUserState = await runtime.getParticipantUserState(message.roomId, runtime.agentId)

      if (
        agentUserState === 'MUTED' &&
        !message.content.text?.toLowerCase().includes(runtime.character.name.toLowerCase())
      ) {
        logger.debug('Ignoring muted room')
        return
      }

      let state = await runtime.composeState(message, [
        'PROVIDERS',
        'SHOULD_RESPOND',
        'CHARACTER',
        'RECENT_MESSAGES',
        'ENTITIES'
      ])

      const shouldRespondPrompt = composePromptFromState({
        state,
        template: runtime.character.templates?.shouldRespondTemplate || shouldRespondTemplate
      })

      logger.debug(
        `*** Should Respond Prompt for ${runtime.character.name} ***\n`,
        shouldRespondPrompt
      )

      const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt: shouldRespondPrompt
      })

      logger.debug(`*** Should Respond Response for ${runtime.character.name} ***\n`, response)
      logger.debug(`*** Raw Response Type: ${typeof response} ***`)

      // Try to preprocess response by removing code blocks markers if present
      let processedResponse = response
      if (typeof response === 'string' && response.includes('```')) {
        logger.debug('*** Response contains code block markers, attempting to clean up ***')
        processedResponse = response.replace(/```json\n|\n```|```/g, '')
        logger.debug('*** Processed Response ***\n', processedResponse)
      }

      const responseObject = parseJSONObjectFromText(processedResponse)
      logger.debug('*** Parsed Response Object ***', responseObject)

      // Safely handle the case where parsing returns null
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const providers = responseObject?.providers as string[] | undefined
      logger.debug('*** Providers Value ***', providers)

      const shouldRespond = responseObject?.action && responseObject.action === 'RESPOND'
      logger.debug('*** Should Respond ***', shouldRespond)

      state = await runtime.composeState(message, undefined, providers)

      let responseMessages: Memory[] = []

      if (shouldRespond) {
        const prompt = composePromptFromState({
          state,
          template: runtime.character.templates?.messageHandlerTemplate || messageHandlerTemplate
        })

        let responseContent: Content | null = null

        // Retry if missing required fields
        let retries = 0
        const maxRetries = 3
        while (retries < maxRetries && (!responseContent?.thought || !responseContent?.actions)) {
          const response = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt
          })

          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          responseContent = parseJSONObjectFromText(response) as Content

          retries++
          if (!responseContent?.thought && !responseContent?.actions) {
            logger.warn('*** Missing required fields, retrying... ***')
          }
        }

        // Check if this is still the latest response ID for this agent+room
        const currentResponseId = agentResponses.get(message.roomId)
        if (currentResponseId !== responseId) {
          logger.info(
            `Response discarded - newer message being processed for agent:` +
              ` ${runtime.agentId}, room: ${message.roomId}`
          )
          return
        }

        if (responseContent) {
          responseContent.inReplyTo = createUniqueUuid(runtime, messageId)

          // last line of defense to ensure the response is valid
          const validation = await validateResponse({
            runtime,
            response: responseContent,
            requestText: message.content.text || '',
            context: prompt
          })

          if (validation) {
            responseContent = validation
          }

          responseMessages = [
            {
              id: asUUID(v4()),
              entityId: runtime.agentId,
              agentId: runtime.agentId,
              content: responseContent,
              roomId: message.roomId,
              createdAt: Date.now()
            }
          ]

          void callback(responseContent)
        }

        // Clean up the response ID
        agentResponses.delete(message.roomId)
        if (agentResponses.size === 0) {
          latestResponseIds.delete(runtime.agentId)
        }

        await runtime.processActions(message, responseMessages, state, callback)
      }
      onComplete?.()
      await runtime.evaluate(message, state, shouldRespond, callback, responseMessages)

      // Emit run ended event on successful completion
      await runtime.emitEvent(EventType.RUN_ENDED, {
        runtime,
        runId,
        messageId: message.id,
        roomId: message.roomId,
        entityId: message.entityId,
        startTime,
        status: 'completed',
        endTime: Date.now(),
        duration: Date.now() - startTime,
        source: 'messageHandler'
      })
    } catch (error) {
      onComplete?.()
      // Emit run ended event with error
      await runtime.emitEvent(EventType.RUN_ENDED, {
        runtime,
        runId,
        messageId: message.id,
        roomId: message.roomId,
        entityId: message.entityId,
        startTime,
        status: 'completed',
        endTime: Date.now(),
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        source: 'messageHandler'
      })
      throw error
    }
  })()

  try {
    await Promise.race([processingPromise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
