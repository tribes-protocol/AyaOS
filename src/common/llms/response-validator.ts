import { isNull } from '@/common/functions'
import { IAyaRuntime } from '@/index'
import { Content, ModelType } from '@elizaos/core'
import { z } from 'zod'

const ResponseValidationSchema = z.object({
  valid: z.boolean(),
  correctedResponse: z.string(),
  correctedAction: z.string().optional().nullable(),
  explanation: z.string()
})

type ResponseValidatorParams = {
  context: string
  response: Content
  requestText: string
  runtime: IAyaRuntime
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
<TEXT>${response.text}</TEXT>
<ACTION>${response.action}</ACTION>
</ANSWER>

Return your analysis as a JSON object with the following structure. Make sure it's the 
raw json. No markdown or anything else:
{
"valid": boolean,
"correctedResponse": string // Original response if valid, corrected response if invalid
"correctedAction": string | null // Original action if valid, corrected action if invalid (use ACTION.NAME if applicable)
"explanation": string // Brief explanation of why the response was invalid (if applicable)
}`
  /* eslint-enable max-len */

  try {
    console.log('Validating request:', JSON.stringify(response, null, 2))

    // Try to parse the result up to three times
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const validationResult = ResponseValidationSchema.parse(
          await runtime.useModel(ModelType.OBJECT_LARGE, { prompt: validationPrompt })
        )

        if (validationResult.valid) {
          return response
        }

        console.log('Validated response:', JSON.stringify(validationResult, null, 2))

        return {
          ...response,
          text: validationResult.correctedResponse,
          action: validationResult.correctedAction ?? undefined
        }
      } catch (parseError) {
        if (attempt === 2) {
          console.error('Failed to parse validation result after 3 attempts:', parseError)
          return undefined
        }
        // Continue to next attempt
      }
    }

    return undefined
  } catch (error) {
    console.error('Response validation failed:', error)
    return undefined
  }
}
