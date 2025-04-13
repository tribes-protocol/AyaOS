import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export class PathResolver {
  private rootDir: string
  public readonly dataDir: string
  public readonly provisionFile: string
  public readonly registrationFile: string
  public readonly keypairFile: string
  public readonly gitStateFile: string
  public readonly codeDir: string
  public readonly runtimeServerSocketFile: string
  public readonly dbFile: string
  public readonly knowledgeRoot: string

  constructor(rootDir?: string) {
    if (rootDir && !path.isAbsolute(rootDir)) {
      rootDir = path.resolve(process.cwd(), rootDir)
    }

    this.rootDir = rootDir ?? path.join(os.homedir(), '.agentcoin-fun')
    console.log('rootDir:', this.rootDir)

    this.dataDir = this.rootDir
    console.log('dataDir:', this.dataDir)

    this.provisionFile = path.join(this.rootDir, 'provision.json')
    console.log('provisionFile:', this.provisionFile)

    this.registrationFile = path.join(this.rootDir, 'registration.json')
    console.log('registrationFile:', this.registrationFile)

    this.keypairFile = path.join(this.rootDir, 'agent-keypair.json')
    console.log('keypairFile:', this.keypairFile)

    this.gitStateFile = path.join(this.rootDir, 'agent-git.json')
    console.log('gitStateFile:', this.gitStateFile)

    this.codeDir = path.join(this.rootDir, 'code')
    console.log('codeDir:', this.codeDir)

    this.runtimeServerSocketFile = path.join(this.rootDir, 'runtime-server.sock')
    console.log('runtimeServerSocketFile:', this.runtimeServerSocketFile)

    this.dbFile = path.join(this.rootDir, 'sqlite.db')
    console.log('dbFile:', this.dbFile)

    this.knowledgeRoot = path.join(this.rootDir, 'knowledgeFiles')
    console.log('knowledgeRoot:', this.knowledgeRoot)

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
