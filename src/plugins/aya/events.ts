import { AgentRegistry } from '@/agent/registry'
import { AYA_AGENT_DATA_DIR_KEY } from '@/common/constants'
import { ensureStringSetting, isNull, toJsonTreeString } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import { messageHandlerTemplate, shouldRespondTemplate } from '@/common/templates'
import { validateResponse } from '@/llms/response-validator'
import {
  asUUID,
  ChannelType,
  composePromptFromState,
  Content,
  createUniqueUuid,
  EventType,
  IAgentRuntime,
  InvokePayload,
  logger,
  Memory,
  MessageReceivedHandlerParams,
  ModelType,
  parseJSONObjectFromText,
  postCreationTemplate,
  truncateToCompleteSentence
} from '@elizaos/core'
import { v4 } from 'uuid'

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
  ayaLogger.info('messageReceivedHandler:', JSON.stringify(message, null, 2))
  const messageId = message.id
  if (isNull(messageId)) {
    throw Error(`Message ID is required: ${message}`)
  }

  const dataDir = ensureStringSetting(runtime, AYA_AGENT_DATA_DIR_KEY)
  const { rateLimiter } = AgentRegistry.get(dataDir)

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
      try {
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
      } catch (error) {
        ayaLogger.error('Failed to emit timeout event:', error)
        reject(error)
      }
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
          ayaLogger.warn('Rate limit exceeded, skipping message from user:', message.entityId)
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

      let state = await runtime.composeState(
        message,
        ['PROVIDERS', 'SHOULD_RESPOND', 'CHARACTER', 'RECENT_MESSAGES', 'ENTITIES'],
        ['ACTIONS']
      )

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

      ayaLogger.log('responseObject', responseObject)

      const shouldRespond = responseObject?.action && responseObject.action !== 'IGNORE'
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
          const response = await runtime.useModel(ModelType.TEXT_LARGE, {
            prompt
          })

          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          responseContent = parseJSONObjectFromText(response) as Content

          retries++
          if (!responseContent?.thought && !responseContent?.actions) {
            ayaLogger.warn('*** Missing required fields, retrying... ***')
          }
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

          // make sure if content.actions has a REPLY action, it's the first action
          const actions = responseContent.actions || []
          if (actions.includes('REPLY')) {
            responseContent.actions = actions.filter((action) => action !== 'REPLY')
            responseContent.actions.unshift('REPLY')
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
        }

        ayaLogger.info('responseMessages', toJsonTreeString(responseMessages, { pretty: true }))

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

export const reactionReceivedHandler = async ({
  runtime,
  message
}: {
  runtime: IAgentRuntime
  message: Memory
}): Promise<void> => {
  try {
    await runtime.createMemory(message, 'messages')
  } catch (error) {
    if (error instanceof Error && error.message === '23505') {
      ayaLogger.warn('Duplicate reaction memory, skipping')
      return
    }
    ayaLogger.error('Error in reaction handler:', error)
  }
}

export const postGeneratedHandler = async ({
  runtime,
  callback,
  worldId,
  userId,
  roomId,
  source
}: InvokePayload): Promise<void> => {
  ayaLogger.log('Generating new post...')
  // Ensure world exists first
  await runtime.ensureWorldExists({
    id: worldId,
    name: `${runtime.character.name}'s Feed`,
    agentId: runtime.agentId,
    serverId: userId
  })

  // Ensure timeline room exists
  await runtime.ensureRoomExists({
    id: roomId,
    name: `${runtime.character.name}'s Feed`,
    source,
    type: ChannelType.FEED,
    channelId: `${userId}-home`,
    serverId: userId,
    worldId
  })

  const message = {
    id: createUniqueUuid(runtime, `tweet-${Date.now()}`),
    entityId: runtime.agentId,
    agentId: runtime.agentId,
    roomId,
    content: {}
  }

  // Compose state with relevant context for tweet generation
  const state = await runtime.composeState(message, undefined, [
    'CHARACTER',
    'RECENT_MESSAGES',
    'ENTITIES'
  ])

  // Generate prompt for tweet content
  const postPrompt = composePromptFromState({
    state,
    template: runtime.character.templates?.postCreationTemplate || postCreationTemplate
  })

  const jsonResponse: {
    post: string
    thought: string
  } = await runtime.useModel(ModelType.OBJECT_LARGE, {
    prompt: postPrompt,
    output: 'no-schema'
  })

  /**
   * Cleans up a tweet text by removing quotes and fixing newlines
   */
  function cleanupPostText(text: string): string {
    // Remove quotes
    let cleanedText = text.replace(/^['"](.*)['"]$/, '$1')
    // Fix newlines
    cleanedText = cleanedText.replaceAll(/\\n/g, '\n\n')
    // Truncate to Twitter's character limit (280)
    if (cleanedText.length > 280) {
      cleanedText = truncateToCompleteSentence(cleanedText, 280)
    }
    return cleanedText
  }

  // Cleanup the tweet text
  const cleanedText = cleanupPostText(jsonResponse.post)

  // Prepare media if included
  // const mediaData: MediaData[] = [];
  // if (jsonResponse.imagePrompt) {
  // 	const images = await runtime.useModel(ModelType.IMAGE, {
  // 		prompt: jsonResponse.imagePrompt,
  // 		output: "no-schema",
  // 	});
  // 	try {
  // 		// Convert image prompt to Media format for fetchMediaData
  // 		const imagePromptMedia: any[] = images

  // 		// Fetch media using the utility function
  // 		const fetchedMedia = await fetchMediaData(imagePromptMedia);
  // 		mediaData.push(...fetchedMedia);
  // 	} catch (error) {
  // 		ayaLogger.error("Error fetching media for tweet:", error);
  // 	}
  // }

  // Create the response memory
  const responseMessages = [
    {
      id: asUUID(v4()),
      entityId: runtime.agentId,
      agentId: runtime.agentId,
      content: {
        text: cleanedText,
        source,
        channelType: ChannelType.FEED,
        thought: jsonResponse.thought || '',
        type: 'post'
      },
      roomId: message.roomId,
      createdAt: Date.now()
    }
  ]

  for (const message of responseMessages) {
    await callback?.(message.content)
  }

  // Process the actions and execute the callback
  // await runtime.processActions(message, responseMessages, state, callback);

  // // Run any configured evaluators
  // await runtime.evaluate(
  // 	message,
  // 	state,
  // 	true, // Post generation is always a "responding" scenario
  // 	callback,
  // 	responseMessages,
  // );
}
