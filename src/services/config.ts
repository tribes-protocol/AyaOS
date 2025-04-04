import { AGENTCOIN_MONITORING_ENABLED } from '@/common/env'
import { isNull, isRequiredString } from '@/common/functions'
import { OperationQueue } from '@/common/lang/operation_queue'
import { ayaLogger } from '@/common/logger'
import { PathResolver } from '@/common/path-resolver'
import { ServiceKind } from '@/common/types'
import { EventService } from '@/services/event'
import { ProcessService } from '@/services/process'
import { IAgentRuntime, Service, ServiceType } from '@elizaos/core'
import express from 'express'
import fs from 'fs'
import net from 'net'
import simpleGit from 'simple-git'

export class ConfigService extends Service {
  private readonly operationQueue = new OperationQueue(1)
  private isRunning = false
  private gitCommitHash: string | undefined
  private characterChecksum: string | undefined
  private server: net.Server | undefined

  static get serviceType(): ServiceType {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ServiceKind.config as unknown as ServiceType
  }

  constructor(
    private readonly eventService: EventService,
    private readonly processService: ProcessService,
    private readonly pathResolver: PathResolver
  ) {
    super()
  }

  async initialize(_: IAgentRuntime): Promise<void> {}

  async start(): Promise<void> {
    ayaLogger.info('Starting config service...')
    // disable in dev mode
    if (process.env.NODE_ENV !== 'production') {
      ayaLogger.info('Config service disabled in dev mode')
      return
    }

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
      await Promise.all([this.checkCodeUpdate()])
      await new Promise((resolve) => setTimeout(resolve, 30000))
    }
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
            await this.processService.kill()
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
}
