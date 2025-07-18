import { isNull, isRequiredString } from '@/common/functions'
import { OperationQueue } from '@/common/lang/operation_queue'
import { ayaLogger } from '@/common/logger'
import { EventManager } from '@/managers/event'
import { PathManager } from '@/managers/path'
import crypto from 'crypto'
import express from 'express'
import fs from 'fs'
import net from 'net'
import simpleGit from 'simple-git'

export class ConfigManager {
  private readonly operationQueue = new OperationQueue(1)
  private isRunning = false
  private gitCommitHash: string | undefined
  private envvarsChecksum: string | undefined
  private server: net.Server | undefined
  private shutdownFunc?: (signal?: string) => Promise<void>

  constructor(
    private readonly eventService: EventManager,
    private readonly pathResolver: PathManager
  ) {
    //
  }

  setShutdownFunc(func: (signal?: string) => Promise<void>): void {
    this.shutdownFunc = func
  }

  async kill(): Promise<void> {
    if (isNull(this.shutdownFunc)) {
      ayaLogger.log('No shutdown function set. killing process...')
      process.kill(process.pid, 'SIGTERM')
    }
    await this.shutdownFunc?.()
  }

  async start(): Promise<void> {
    ayaLogger.log('Starting config service...')
    // disable in dev mode
    if (process.env.NODE_ENV !== 'production') {
      ayaLogger.log('Config service disabled in dev mode')
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
      ayaLogger.log(`Received command request: ${kind}`)

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

      ayaLogger.log(`New envvars file detected. Restarting agent...`)
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
          ayaLogger.log(
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
          ayaLogger.log('Git directory not initiated yet')
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
      ayaLogger.log('Closing server')
      if (fs.existsSync(this.pathResolver.runtimeServerSocketFile)) {
        ayaLogger.log('Removing socket file')
        fs.unlinkSync(this.pathResolver.runtimeServerSocketFile)
      }
      this.server = undefined
    }
    ayaLogger.log('Stopping config service...')
  }
}
