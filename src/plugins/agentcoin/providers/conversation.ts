import { isNull } from '@/common/functions'
import { AgentcoinRuntime } from '@/common/runtime'
import { Memory, Provider, State } from '@elizaos/core'

const conversationProvider: Provider = {
  get: async (runtime: AgentcoinRuntime, memory: Memory, _state?: State): Promise<string> => {
    const isSelf = memory.userId === runtime.agentId

    if (isSelf) {
      return `
      **This is your message**
      User ID: ${memory.userId}
      Name: ${runtime.character.name}
      `
    }

    // // source != 'agentcoin', bail out
    // if (memory.content.source !== 'agentcoin') {
    //   return ''
    // }

    const account = await runtime.databaseAdapter.getAccountById(memory.userId)

    if (isNull(account)) {
      return ''
    }

    const username = account.username
    const name = account.name
    const email = account.email
    const avatarUrl = account.avatarUrl
    const bio = account.details?.bio
    const source = account.details?.source
    const ethAddress = account.details?.ethAddress

    const details = [
      `User ID: ${memory.userId}`,
      username && `Username: ${username}`,
      name && `Name: ${name}`,
      email && `Email: ${email}`,
      bio && `Bio: ${bio}`,
      avatarUrl && `Profile Image: ${avatarUrl}`,
      ethAddress && `Ethereum Address: ${ethAddress}`
    ].filter(Boolean)

    return `
    **You are talking to the following user ${isNull(source) ? '' : `from ${source}`}**
    ${details.map((detail) => `- ${detail}`).join('\n')}
    `.trim()
  }
}

export { conversationProvider }
