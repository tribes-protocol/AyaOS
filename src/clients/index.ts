import { AgentcoinClientInterface } from '@/clients/agentcoin'
import FarcasterClientInterface from '@/clients/farcaster'
import TelegramClientInterface from '@/clients/telegram'
import TwitterClientInterface from '@/clients/twitter'
import { AgentRuntime, Character, Client, Clients } from '@elizaos/core'

export async function initializeClients(
  character: Character,
  runtime: AgentRuntime
): Promise<Client[]> {
  const clients: Client[] = []
  const clientTypes = character.clients?.map((str) => str.toLowerCase()) || []

  if (clientTypes.includes(Clients.TELEGRAM)) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const telegramClient = (await TelegramClientInterface.start(runtime)) as Client
    if (telegramClient) clients.push(telegramClient)
  }

  if (clientTypes.includes(Clients.TWITTER)) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const twitterClients = (await TwitterClientInterface.start(runtime)) as Client
    clients.push(twitterClients)
  }

  if (clientTypes.includes(Clients.FARCASTER)) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const farcasterClient = (await FarcasterClientInterface.start(runtime)) as Client
    if (farcasterClient) clients.push(farcasterClient)
  }

  // add the agentcoin client
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const agentcoinClient = (await AgentcoinClientInterface.start(runtime)) as Client
  if (agentcoinClient) clients.push(agentcoinClient)

  if (character.plugins?.length > 0) {
    for (const plugin of character.plugins) {
      if (plugin.clients) {
        for (const client of plugin.clients) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          clients.push((await client.start(runtime)) as Client)
        }
      }
    }
  }

  return clients
}
