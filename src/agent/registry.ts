import RateLimiter from '@/agent/ratelimiter'
import { isNull } from '@/common/functions'
import { AuthInfo, AyaOSOptions } from '@/common/types'
import { LoginManager } from '@/managers/admin'
import { ConfigManager } from '@/managers/config'
import { EventManager } from '@/managers/event'
import { KeychainManager } from '@/managers/keychain'
import { PathManager } from '@/managers/path'
import { logger } from '@elizaos/core'

export interface AgentContext {
  auth: AuthInfo
  dataDir: string
  rateLimiter?: RateLimiter
  managers: {
    event: EventManager
    config: ConfigManager
    keychain: KeychainManager
    login: LoginManager
    path: PathManager
  }
}

export const AgentRegistry = {
  instances: new Map<string, AgentContext>(),

  async setup(options?: AyaOSOptions): Promise<AgentContext> {
    const expandedDataDir = options?.dataDir?.startsWith('~')
      ? options.dataDir.replace('~', process.env.HOME || '')
      : options?.dataDir

    const pathResolver = new PathManager(expandedDataDir)
    const dataDir = pathResolver.dataDir

    if (this.instances.has(dataDir)) {
      throw new Error('Agent already registered: ' + dataDir)
    }

    const keychain = new KeychainManager(pathResolver.keypairFile)
    const loginManager = new LoginManager(keychain, pathResolver)
    const authInfo = await loginManager.provisionIfNeeded()

    // eagerly setup managers and start event manager
    const eventManager = new EventManager(authInfo.token)
    const configManager = new ConfigManager(eventManager, pathResolver)
    void eventManager.start()

    const context: AgentContext = {
      auth: authInfo,
      dataDir,
      rateLimiter: options?.rateLimiter,
      managers: {
        event: eventManager,
        config: configManager,
        keychain,
        login: loginManager,
        path: pathResolver
      }
    }

    this.instances.set(dataDir, context)
    return context
  },

  get(dataDir: string): AgentContext {
    const context = this.instances.get(dataDir)
    if (isNull(context)) {
      throw new Error('Agent not registered: ' + dataDir)
    }
    return context
  },

  async destroy(dataDir: string): Promise<void> {
    const context = this.instances.get(dataDir)
    if (isNull(context)) {
      console.warn('Agent not registered: ' + dataDir)
      return
    }

    await context.managers.event.stop()
    await context.managers.config.stop()
    this.instances.delete(dataDir)
  },

  async destroyAll(): Promise<void> {
    for (const dataDir of this.instances.keys()) {
      await this.destroy(dataDir)
    }
  }
}
