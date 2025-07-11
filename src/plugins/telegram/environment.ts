import type { IAgentRuntime } from '@elizaos/core'
import { z } from 'zod'

export const telegramEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'Telegram bot token is required'),
  TELEGRAM_TIMEOUT: z.coerce.number().int().nullish()
})

/**
 * Represents the type definition for configuring a Telegram bot based on the inferred schema.
 */
export type TelegramConfig = z.infer<typeof telegramEnvSchema>

/**
 * Validates the Telegram configuration by retrieving the Telegram bot token from the runtime
 * settings or environment variables.
 *
 * @param {IAgentRuntime} runtime - The agent runtime used to get the setting.
 * @returns {Promise<TelegramConfig>} A promise that resolves with the validated Telegram
 * configuration.
 */
export async function validateTelegramConfig(runtime: IAgentRuntime): Promise<TelegramConfig> {
  try {
    const config = {
      TELEGRAM_BOT_TOKEN:
        runtime.getSetting('TELEGRAM_BOT_TOKEN') || process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_TIMEOUT: runtime.getSetting('TELEGRAM_TIMEOUT') || process.env.TELEGRAM_TIMEOUT
    }

    return telegramEnvSchema.parse(config)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('\n')
      throw new Error(`Telegram configuration validation failed: ${errorMessages}`)
    }
    throw error
  }
}
