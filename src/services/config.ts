import { isNull, isRequiredString } from '@/common/functions'
import { OperationQueue } from '@/common/lang/operation_queue'
import { ayaLogger } from '@/common/logger'
import { PathResolver } from '@/common/path-resolver'
import { EventService } from '@/services/event'
import { IAgentRuntime, Service } from '@elizaos/core'
import crypto from 'crypto'
import express from 'express'
import fs from 'fs'
import net from 'net'
import simpleGit from 'simple-git'

export class ConfigService extends Service {
  private readonly operationQueue = new OperationQueue(1)
  private isRunning = false
  private gitCommitHash: string | undefined
  private envvarsChecksum: string | undefined
  private server: net.Server | undefined
  private shutdownFunc?: (signal?: string) => Promise<void>

  static readonly serviceType = 'aya-os-config-service'
  readonly capabilityDescription = ''

  private constructor(
    private readonly eventService: EventService,
    private readonly pathResolver: PathResolver
  ) {
    super(undefined)
  }

  static getInstance(eventService: EventService, pathResolver: PathResolver): ConfigService {
    if (isNull(instance)) {
      instance = new ConfigService(eventService, pathResolver)
    }
    return instance
  }

  setShutdownFunc(func: (signal?: string) => Promise<void>): void {
    this.shutdownFunc = func
  }

  async kill(): Promise<void> {
    if (isNull(this.shutdownFunc)) {
      console.log('No shutdown function set. killing process...')
      process.kill(process.pid, 'SIGTERM')
    }
    await this.shutdownFunc?.()
  }

  private async start(): Promise<void> {
    console.log(`[aya] starting ${ConfigService.serviceType} service`)
    ayaLogger.info('Starting config service...')
    // disable in dev mode
    if (process.env.NODE_ENV !== 'production') {
      ayaLogger.info('Config service disabled in dev mode')
      return
    }

    const AGENTCOIN_MONITORING_ENABLED = this.runtime.getSetting('AGENTCOIN_MONITORING_ENABLED')

    if (!AGENTCOIN_MONITORING_ENABLED) {
      ayaLogger.info('Agentcoin monitoring disabled')
      return
    }

    if (this.isRunning) {
      return
    }

    this.isRunning = true

    // Start express server on Unix domain socket
    const app = express()

    app.get('/command/new', async (req, res) => {
      const { kind } = req.query
      ayaLogger.info(`Received command request: ${kind}`)

      if (isNull(kind)) {
        res.status(400).json({ error: 'Kind parameter is required' })
        return
      }

      try {
        switch (kind) {
          case 'git':
            res.json({ success: true })
            await this.checkCodeUpdate()
            break
          default:
            res.status(400).json({ error: `Invalid kind parameter: ${kind}` })
        }
      } catch (error) {
        ayaLogger.error('Error processing command:', error)
        res.status(500).json({ error: 'Internal server error' })
      }
    })

    // Remove existing socket file if it exists
    if (fs.existsSync(this.pathResolver.runtimeServerSocketFile)) {
      fs.unlinkSync(this.pathResolver.runtimeServerSocketFile)
    }

    this.server = app.listen(this.pathResolver.runtimeServerSocketFile)

    while (this.isRunning) {
      await Promise.all([this.checkCodeUpdate(), this.checkEnvUpdate()])
      await new Promise((resolve) => setTimeout(resolve, 30000))
    }
  }

  async checkEnvUpdate(): Promise<void> {
    await this.operationQueue.submit(async () => {
      const envvars = fs.readFileSync(this.pathResolver.envFile, 'utf8')
      const checksum = crypto.createHash('md5').update(envvars).digest('hex')
      if (isNull(this.envvarsChecksum) || this.envvarsChecksum === checksum) {
        this.envvarsChecksum = checksum
        return
      }

      ayaLogger.info(`New envvars file detected. Restarting agent...`)
      await this.eventService.publishEnvChangeEvent(envvars)
      this.envvarsChecksum = checksum

      if (process.env.NODE_ENV === 'production') {
        await this.kill()
      }
    })
  }

  private async checkCodeUpdate(): Promise<void> {
    await this.operationQueue.submit(async () => {
      try {
        const git = simpleGit(this.pathResolver.codeDir)
        const commitHash = (await git.revparse(['HEAD'])).trim()
        const remoteUrl = await git.remote(['get-url', 'origin'])

        if (!isRequiredString(remoteUrl)) {
          ayaLogger.error('No remote url found')
          return
        }

        if (isNull(this.gitCommitHash) || this.gitCommitHash === commitHash) {
          this.gitCommitHash = commitHash
        } else {
          // kill the process and docker container should restart it
          ayaLogger.info(
            `New code detected current=${this.gitCommitHash} new=${commitHash}. Restarting agent...`
          )
          this.gitCommitHash = commitHash
          await this.eventService.publishCodeChangeEvent(commitHash.trim(), remoteUrl.trim())
          if (process.env.NODE_ENV === 'production') {
            await this.kill()
          }
        }
      } catch (e) {
        if (
          e instanceof Error &&
          e.message.includes('Cannot use simple-git on a directory that does not exist')
        ) {
          ayaLogger.info('Git directory not initiated yet')
        } else {
          ayaLogger.error('Error checking git status:', e)
        }
      }
    })
  }

  async stop(): Promise<void> {
    this.isRunning = false
    if (this.server) {
      this.server.close()
      console.log('Closing server')
      if (fs.existsSync(this.pathResolver.runtimeServerSocketFile)) {
        console.log('Removing socket file')
        fs.unlinkSync(this.pathResolver.runtimeServerSocketFile)
      }
      this.server = undefined
    }
    ayaLogger.info('Stopping config service...')
  }

  static async start(_runtime: IAgentRuntime): Promise<Service> {
    if (isNull(instance)) {
      throw new Error('ConfigService not initialized')
    }
    // don't await this. it'll lock up the main process
    void instance.start()
    return instance
  }

  static async stop(_runtime: IAgentRuntime): Promise<unknown> {
    if (isNull(instance)) {
      throw new Error('ConfigService not initialized')
    }
    await instance.stop()
    return instance
  }
}

let instance: ConfigService | undefined
