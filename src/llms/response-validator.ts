import { isNull } from '@/common/functions'
import { ayaLogger } from '@/common/logger'
import { Content, IAgentRuntime, ModelType } from '@elizaos/core'
import { z } from 'zod'

const ResponseValidationSchema = z.object({
  valid: z.union([
    z.boolean(),
    z.string().transform((val) => {
      if (val === 'true') return true
      if (val === 'false') return false
      throw new Error(`Invalid boolean string: ${val}`)
    })
  ]),
  correctedText: z.string(),
  correctedActions: z.array(z.string()).nullish(),
  reasoning: z.string().default('No explanation provided')
})

type ResponseValidatorParams = {
  context: string
  response: Content
  requestText: string
  runtime: IAgentRuntime
}

export async function validateResponse({
  runtime,
  response,
  requestText,
  context
}: ResponseValidatorParams): Promise<Content | undefined> {
  const character = runtime.character
  if (isNull(character.system)) {
    return response
  }

  /* eslint-disable max-len */
  const validationPrompt = `You are a response validator for an AI assistant. 
Your task is to check if the following response strictly adheres to the system rules defined in the CONTEXT.

If the response violates ANY of the rules, you must return a JSON object with "valid": false 
and "correctedResponse" and "correctedAction" (if applicable) contains the updated response and action. If you're not ABSOLUTELY sure about the 
updated response, return the original response.

If the response follows ALL rules, return a JSON with "valid": true and the original "response" and "action" (if applicable).

<SYSTEM>
${character.system}
</SYSTEM>

<CONTEXT>
${context}
</CONTEXT>

QUESTION:
<QUESTION>
${requestText}
</QUESTION>

ANSWER TO VALIDATE:
<ANSWER>
<TEXT>${response.message}</TEXT>
<ACTIONS>${response.actions}</ACTIONS>
</ANSWER>

Return your analysis as a JSON object with the following structure. Make sure it's the 
raw json. No markdown or anything else:
{
"valid": boolean,
"correctedText": string // Original text if valid, corrected text if invalid
"correctedActions": string[] | null // Original actions if valid, corrected actions if invalid (use ACTION.NAME if applicable)
"reasoning": string // Brief explanation of why the response was invalid (if applicable)
}`
  /* eslint-enable max-len */

  try {
    ayaLogger.log('Validating request:', JSON.stringify(response, null, 2))

    // Try to parse the result up to three times
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const validationResult = ResponseValidationSchema.parse(
          await runtime.useModel(ModelType.OBJECT_LARGE, { prompt: validationPrompt })
        )

        if (validationResult.valid) {
          return response
        }

        ayaLogger.log('Validated response:', JSON.stringify(validationResult, null, 2))

        return {
          ...response,
          message: validationResult.correctedText,
          actions: validationResult.correctedActions ?? undefined
        }
      } catch (parseError) {
        if (attempt === 2) {
          ayaLogger.error('Failed to parse validation result after 3 attempts:', parseError)
          return undefined
        }
        // Continue to next attempt
      }
    }

    return undefined
  } catch (error) {
    ayaLogger.error('Response validation failed:', error)
    return undefined
  }
}
