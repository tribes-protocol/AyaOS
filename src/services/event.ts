import { AgentcoinAPI } from '@/apis/agentcoinfun'
import { ayaLogger } from '@/common/logger'

export class EventService {
  constructor(
    private readonly agentcoinCookie: string,
    private readonly agentcoinAPI: AgentcoinAPI
  ) {}

  private heartbeatInterval?: NodeJS.Timeout

  async start(): Promise<void> {
    ayaLogger.info('Starting event service...')
    if (this.heartbeatInterval) {
      ayaLogger.info('Event service already started')
      return
    }

    await this.agentcoinAPI.publishEvent(
      {
        kind: 'health',
        status: 'booting',
        sentAt: new Date()
      },
      { cookie: this.agentcoinCookie }
    )

    // Start heartbeat interval
    this.heartbeatInterval = setInterval(() => {
      void this.publishHeartbeatEvent()
    }, 300000) // Send heartbeat every 5 minutes

    await this.publishHeartbeatEvent()
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }

    await this.agentcoinAPI.publishEvent(
      {
        kind: 'health',
        status: 'stopped',
        sentAt: new Date()
      },
      { cookie: this.agentcoinCookie }
    )

    ayaLogger.info('Event service stopped')
  }

  async publishEnvChangeEvent(envContents: string): Promise<void> {
    const envvarsRecord: Record<string, string> = envContents
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .reduce((acc, line) => {
        const [key, ...valueParts] = line.split('=')
        const value = valueParts.join('=')
        if (key && value) {
          acc[key.trim()] = value.trim()
        }
        return acc
      }, {})

    await this.agentcoinAPI.publishEvent(
      {
        kind: 'env_var_change',
        envVars: envvarsRecord,
        sentAt: new Date()
      },
      {
        cookie: this.agentcoinCookie
      }
    )
  }

  async publishHeartbeatEvent(): Promise<void> {
    await this.agentcoinAPI.publishEvent(
      {
        kind: 'health',
        status: 'running',
        sentAt: new Date()
      },
      { cookie: this.agentcoinCookie }
    )
  }

  async publishCodeChangeEvent(commitHash: string, remoteUrl: string): Promise<void> {
    await this.agentcoinAPI.publishEvent(
      {
        kind: 'code_change',
        git: { commit: commitHash, remoteUrl },
        sentAt: new Date()
      },
      { cookie: this.agentcoinCookie }
    )
  }
}
