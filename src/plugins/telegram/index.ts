import { ayaLogger } from '@/common/logger'
import { TELEGRAM_SERVICE_NAME } from '@/plugins/telegram/constants'
import { TelegramService } from '@/plugins/telegram/service'
import type { Plugin } from '@elizaos/core'

export const telegramPlugin: Plugin = {
  name: TELEGRAM_SERVICE_NAME,
  description: 'Telegram client plugin',
  services: [TelegramService],
  tests: [],
  init: async (_config, runtime) => {
    ayaLogger.log('telegramPlugin init for agentId', runtime.agentId)
  }
}
