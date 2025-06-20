import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export class PathManager {
  public readonly dataDir: string
  public readonly envFile: string
  public readonly provisionFile: string
  public readonly registrationFile: string
  public readonly keypairFile: string
  public readonly gitStateFile: string
  public readonly codeDir: string
  public readonly runtimeServerSocketFile: string
  public readonly knowledgeRoot: string
  public readonly xmtpDbDir: string

  constructor(rootDir?: string) {
    if (rootDir && !path.isAbsolute(rootDir)) {
      rootDir = path.resolve(process.cwd(), rootDir)
    }

    this.dataDir = rootDir ?? path.join(os.homedir(), '.ayaos')
    this.envFile = path.join(this.dataDir, '.env')
    this.provisionFile = path.join(this.dataDir, 'provision.json')
    this.registrationFile = path.join(this.dataDir, 'registration.json')
    this.keypairFile = path.join(this.dataDir, 'agent-keypair.json')
    this.gitStateFile = path.join(this.dataDir, 'agent-git.json')
    this.codeDir = path.join(this.dataDir, 'code')
    this.runtimeServerSocketFile = path.join(this.dataDir, 'runtime-server.sock')
    this.knowledgeRoot = path.join(this.dataDir, 'knowledgeFiles')
    this.xmtpDbDir = path.join(this.dataDir, 'xmtp-db')

    this.ensureRootDirExists()
  }

  private ensureRootDirExists(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true })
    }

    if (!fs.existsSync(this.knowledgeRoot)) {
      fs.mkdirSync(this.knowledgeRoot, { recursive: true })
    }

    if (!fs.existsSync(this.xmtpDbDir)) {
      fs.mkdirSync(this.xmtpDbDir, { recursive: true })
    }
  }
}
