import { AgentcoinClient } from '@/clients/aya/agentcoinfun'
import { FarcasterManager } from '@/clients/farcaster'
import { validateFarcasterConfig } from '@/clients/farcaster/environment'
import { TelegramClient } from '@/clients/telegram/telegramClient'
import { TwitterManager } from '@/clients/twitter'
import { validateTwitterConfig } from '@/clients/twitter/environment'
import { Client, IAyaRuntime } from '@/common/iruntime'
import { Character, Clients } from '@elizaos/core'

export async function initializeClients(
  character: Character,
  runtime: IAyaRuntime
): Promise<Record<string, Client>> {
  const clients: Record<string, Client> = {}
  const clientTypes = character.clients?.map((str) => str.toLowerCase()) || []

  if (clientTypes.includes(Clients.TELEGRAM)) {
    const tg = new TelegramClient(
      runtime,
      runtime.ensureSetting('TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN is not set')
    )
    await tg.start(runtime)
    clients.telegram = tg
  }

  if (clientTypes.includes(Clients.TWITTER)) {
    const twitterConfig = await validateTwitterConfig(runtime)
    const twitterManager = new TwitterManager(runtime, twitterConfig)
    await twitterManager.start(runtime)
    clients.twitter = twitterManager
  }

  if (clientTypes.includes(Clients.FARCASTER)) {
    const farcasterConfig = await validateFarcasterConfig(runtime)
    const farcasterClient = new FarcasterManager(runtime, farcasterConfig)
    await farcasterClient.start(runtime)
    clients.farcaster = farcasterClient
  }

  // add the agentcoin client
  const agentcoinClient = new AgentcoinClient(runtime)
  await agentcoinClient.start(runtime)
  clients.agentcoin = agentcoinClient

  if (character.plugins?.length > 0) {
    for (const plugin of character.plugins) {
      if (plugin.clients) {
        for (let i = 0; i < plugin.clients.length; i++) {
          const client = plugin.clients[i]
          const clientInstance = await client.start(runtime)
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          if (clientInstance) clients[`${plugin.name}_${i}`] = clientInstance as Client
        }
      }
    }
  }

  return clients
}
