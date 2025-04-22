import { AyaAuthAPI } from '@/apis/aya-auth'

export class EventManager {
  private readonly agentcoinAPI: AyaAuthAPI
  constructor(token: string) {
    this.agentcoinAPI = new AyaAuthAPI(token)
  }

  private heartbeatInterval?: NodeJS.Timeout

  async start(): Promise<void> {
    console.log('Starting event service...')
    if (this.heartbeatInterval) {
      console.log('Event service already started')
      return
    }

    await this.agentcoinAPI.publishEvent({
      kind: 'health',
      status: 'booting',
      sentAt: new Date()
    })

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

    await this.agentcoinAPI.publishEvent({
      kind: 'health',
      status: 'stopped',
      sentAt: new Date()
    })

    console.log('Event service stopped')
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

    await this.agentcoinAPI.publishEvent({
      kind: 'env_var_change',
      envVars: envvarsRecord,
      sentAt: new Date()
    })
  }

  async publishHeartbeatEvent(): Promise<void> {
    await this.agentcoinAPI.publishEvent({
      kind: 'health',
      status: 'running',
      sentAt: new Date()
    })
  }

  async publishCodeChangeEvent(commitHash: string, remoteUrl: string): Promise<void> {
    await this.agentcoinAPI.publishEvent({
      kind: 'code_change',
      git: { commit: commitHash, remoteUrl },
      sentAt: new Date()
    })
  }
}
