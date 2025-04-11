import { ayaLogger } from '@/common/logger'
import { EmbeddingsConfig } from '@/common/types'

/**
 * Generates embeddings for the given text using the specified configuration
 * @param text The text to embed
 * @param config The embedding configuration
 * @returns A vector of numbers representing the embedding
 */
export async function embed(text: string, config: EmbeddingsConfig): Promise<number[]> {
  // Construct full URL
  const fullUrl = `${config.endpoint}/embeddings`

  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      input: text,
      model: config.model
    })
  }

  try {
    const response = await fetch(fullUrl, requestOptions)

    if (!response.ok) {
      const errorText = await response.text()
      ayaLogger.error('Request URL:', fullUrl)
      ayaLogger.error(
        'Request body:',
        JSON.stringify(
          {
            input: text,
            model: config.model
          },
          null,
          2
        )
      )
      ayaLogger.error('API Response:', errorText)
      throw new Error(
        `Embedding API Error: ${response.status} ${response.statusText}\n${errorText}`
      )
    }

    interface EmbeddingResponse {
      data: Array<{ embedding: number[] }>
    }

    const data: EmbeddingResponse = await response.json()
    return data?.data?.[0].embedding
  } catch (e) {
    ayaLogger.error('Embedding error:', e)
    throw e
  }
}
