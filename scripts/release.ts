import { execSync } from 'child_process'

const tag = process.env.NPM_TAG ?? 'latest'

execSync(`bunx changeset publish --tag ${tag}`, { stdio: 'inherit' })
