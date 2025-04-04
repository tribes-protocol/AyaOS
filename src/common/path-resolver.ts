import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export class PathResolver {
  private rootDir: string
  public readonly dataDir: string
  public readonly envFile: string
  public readonly characterFile: string
  public readonly registrationFile: string
  public readonly keypairFile: string
  public readonly gitStateFile: string
  public readonly codeDir: string
  public readonly runtimeServerSocketFile: string
  public readonly knowledgeRoot: string

  constructor(rootDir?: string) {
    if (rootDir && !path.isAbsolute(rootDir)) {
      rootDir = path.resolve(process.cwd(), rootDir)
    }

    this.rootDir = rootDir ?? path.join(os.homedir(), '.ayaos')

    this.dataDir = this.rootDir
    this.envFile = path.join(this.rootDir, '.env')
    this.characterFile = path.join(this.rootDir, 'character.json')
    this.registrationFile = path.join(this.rootDir, 'registration.json')
    this.keypairFile = path.join(this.rootDir, 'agent-keypair.json')
    this.gitStateFile = path.join(this.rootDir, 'agent-git.json')
    this.codeDir = path.join(this.rootDir, 'code')
    this.runtimeServerSocketFile = path.join(this.rootDir, 'runtime-server.sock')
    this.knowledgeRoot = path.join(this.rootDir, 'knowledgeFiles')

    this.ensureRootDirExists()
  }

  private ensureRootDirExists(): void {
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true })
    }

    if (!fs.existsSync(this.knowledgeRoot)) {
      fs.mkdirSync(this.knowledgeRoot, { recursive: true })
    }
  }
}
