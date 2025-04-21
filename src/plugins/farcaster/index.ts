import { FarcasterService } from '@/plugins/farcaster/service'

const farcasterPlugin = {
  name: 'farcaster',
  description: 'Farcaster client plugin',
  services: [FarcasterService],
  tests: []
}
export default farcasterPlugin
