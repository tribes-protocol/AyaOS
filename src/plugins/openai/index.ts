import { ayaLogger } from '@/common/logger'
import { Plugin } from '@elizaos/core'
import openaiElizaosPlugin from '@elizaos/plugin-openai'

export const openaiPlugin: Plugin = {
  ...openaiElizaosPlugin,
  init: async (_config) => {
    ayaLogger.info('Openai plugin initialized')
  }
}

export default openaiPlugin
