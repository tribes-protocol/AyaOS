# AyaOS

AyaOS is a high-level framework built on top of ElizaOS for creating autonomous AI agents. It provides a simple yet powerful interface for building, customizing, and deploying AI agents with advanced capabilities. Out of the box it uses the free `meta/llama-3.3-70b-instruct-fp8` model from [function.network](https://function.network).

## Quick Start

### Prerequisites

- Node.js 22 or higher

### Installation

The fastest way to bootstrap an agent is with `npx`:

```bash
# Install bun (used by the dev server)
curl -fsSL https://bun.sh/install | bash

npx @tribesxyz/ayaos init
```

After answering the prompts, start the agent:

```bash
cd <project-name>
bun dev
```

### Agent Provisioning

When you start an agent for the first time, it goes through a provisioning process:

1. A keypair is generated for secure communication
2. A CLI authentication flow is initiated (requires user action)
3. The agent connects to the platform
4. A generic character file is created and stored in code base

This process ensures secure and authenticated agent creation with proper identity management.

## Core Abstractions

AyaOS extends ElizaOS with several core abstractions:

### Actions

Actions are tools your agent can use to perform specific tasks. They follow a JSON Schema format for parameters and return results.

```typescript
import { Agent, Action } from '@tribesxyz/ayaos'

// Define a simple greeting action
const greetingAction: Action = {
  name: 'greeting',
  description: 'Greets a person by name',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The name of the person to greet'
      }
    },
    required: ['name']
  },
  execute: async (params) => {
    const { name } = params
    return { result: `Hello, ${name}! Nice to meet you.` }
  }
}

async function main() {
  const agent = new Agent()

  // Register the greeting action
  agent.register('action', greetingAction)

  await agent.start()
}
```

Actions become available to the agent's LLM, which can invoke them based on the context and requirements.

### Services

Services provide reusable functionality to your agent. They encapsulate complex logic and provide a consistent interface for the agent to interact with. Each service has a specific type and implements necessary methods.

AyaOS includes several built-in services:

#### KnowledgeBaseService

Manages the agent's knowledge base, allowing for storage and retrieval of information:

```typescript
import { Agent } from '@tribesxyz/ayaos'

async function main() {
  const agent = new Agent()
  await agent.start()

  // Access the knowledge base service
  const knowledgeItems = await agent.knowledge.search({
    q: 'what is artificial intelligence',
    limit: 5
  })

  // Add knowledge to the agent
  await agent.knowledge.add(someUniqueId, {
    text: 'Important information the agent should know',
    metadata: {
      source: 'documentation',
      type: 'concept'
    }
  })
}
```

#### MemoriesService

Handles the agent's memory and recall capabilities:

```typescript
import { Agent } from '@tribesxyz/ayaos'

async function main() {
  const agent = new Agent()
  await agent.start()

  // Search for memories about a specific topic
  const memories = await agent.memories.search({
    q: 'conversation about machine learning',
    limit: 5,
    type: 'message'
  })
}
```

#### WalletService

Provides crypto wallet functionality for blockchain interactions:

```typescript
import { Agent } from '@tribesxyz/ayaos'

async function main() {
  const agent = new Agent()
  await agent.start()

  // Get the default wallet
  const wallet = await agent.wallet.getDefaultWallet('evm')

  // Sign a message
  const signature = await agent.wallet.signPersonalMessage(wallet, 'Hello, world!')
}
```

#### Creating Custom Services

You can create and register custom services to extend your agent's capabilities:

```typescript
import { Agent, Service, ServiceType } from '@tribesxyz/ayaos'

class WeatherService extends Service {
  static get serviceType(): ServiceType {
    return 'weather' as ServiceType
  }

  async initialize() {
    // Setup code here
    return Promise.resolve()
  }

  async getWeather(location: string) {
    // Implementation to fetch weather data
    return { temperature: 72, conditions: 'sunny' }
  }
}

async function main() {
  const agent = new Agent()

  // Register custom service
  agent.register('service', new WeatherService())

  await agent.start()

  // Access the service
  const weatherService = agent.runtime.getService(WeatherService)
  if (weatherService) {
    const weather = await weatherService.getWeather('New York')
    ayaLogger.info('Weather:', weather)
  }
}
```

Services must implement the `initialize` method, which is called when the agent starts. The `serviceType` static getter is used to identify the service type.

### Providers

Providers act as the agent's "senses," injecting real-time information into the agent's context. They supply dynamic contextual information that integrates with the agent's runtime and serve as a bridge between the agent and various external systems.

```typescript
import { Agent, Provider } from '@tribesxyz/ayaos'

const timeProvider: Provider = {
  name: 'time',
  description: 'Provides the current date and time',
  position: -10, // Run early to ensure time is available for other providers
  get: async (runtime, message, state) => {
    const currentDate = new Date()
    const options = {
      timeZone: 'UTC',
      dateStyle: 'full',
      timeStyle: 'long'
    }
    const humanReadable = new Intl.DateTimeFormat('en-US', options).format(currentDate)

    return {
      text: `The current date and time is ${humanReadable}. Please use this as your reference for any time-based operations or responses.`,
      values: {
        currentDate: currentDate.toISOString(),
        humanReadableDate: humanReadable
      }
    }
  }
}

async function main() {
  const agent = new Agent()

  // Register the provider
  agent.register('provider', timeProvider)

  await agent.start()
}
```

#### Provider Types and Properties

Providers have several properties that control how and when they are used:

1. **Dynamic Providers**: Not automatically included in the context; must be explicitly requested.

```typescript
const dynamicProvider: Provider = {
  name: 'dynamicExample',
  description: 'A dynamic provider example',
  dynamic: true,
  get: async (runtime, message, state) => {
    return {
      text: 'Dynamic information fetched on demand',
      values: {
        /* key-value pairs */
      }
    }
  }
}
```

2. **Private Providers**: Not included in the regular provider list; must be explicitly included.

```typescript
const privateProvider: Provider = {
  name: 'privateExample',
  description: 'A private provider example',
  private: true,
  get: async (runtime, message, state) => {
    return {
      text: 'Private information only available when explicitly requested',
      values: {
        /* key-value pairs */
      }
    }
  }
}
```

3. **Provider Positioning**: The `position` property determines the order in which providers are processed.

```typescript
const earlyProvider: Provider = {
  name: 'earlyExample',
  description: 'Runs early in the provider chain',
  position: -100,
  get: async (runtime, message, state) => {
    return {
      text: 'Early information',
      values: {
        /* key-value pairs */
      }
    }
  }
}
```

#### Provider Result Structure

The `get` function of a provider returns a `ProviderResult` object containing:

- `text`: String that gets injected into the agent's context
- `values`: Key-value pairs to be merged into the agent's state values
- `data`: Additional structured data that can be used by the agent but not directly included in the context

#### Best Practices for Providers

1. **Optimize for Efficiency**

   - Return both structured data (`values`) and formatted text (`text`)
   - Use caching for expensive operations
   - Include a clear provider name and description

2. **Handle Errors Gracefully**

   - Always handle errors without throwing exceptions
   - Return appropriate error information in the result

3. **Use Position for Optimal Order**

   - Negative positions: Fundamental information providers (time, location)
   - Zero (default): Standard information providers
   - Positive positions: Providers that depend on other information

4. **Structure Return Values Consistently**
   - Maintain a consistent structure in your provider's return values

## Default Actions

AyaOS ships with several built-in actions that are ready to use:

- **REPLY** – send a text response back to the user.
- **IGNORE** – end the conversation politely if no reply is needed.
- **CAPABILITIES** – list what the agent can do.
- **WEB_SEARCH** – perform a web search using Tavily.

The default language model is the free `meta/llama-3.3-70b-instruct-fp8` hosted by [function.network](https://function.network).

You can register additional actions or override these as needed.

## Platform Integration

AyaOS includes built-in support for multiple messaging platforms and communication protocols. These integrations are automatically enabled when the required environment variables are configured.

### Telegram Integration

The Telegram plugin allows your agent to communicate on Telegram through a bot interface.

#### Prerequisites

1. Create a Telegram bot by messaging [@BotFather](https://t.me/BotFather) on Telegram
2. Follow the instructions to create a new bot and obtain your bot token

#### Configuration

Add your Telegram bot token to your environment variables:

```bash
# Required: Your Telegram bot token from BotFather
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Optional: Timeout for handling updates (in milliseconds)
TELEGRAM_TIMEOUT=30000
```

#### Features

The Telegram integration provides:

- **Message Handling**: Send and receive text messages
- **Group Support**: Works in both private chats and group conversations
- **Forum Topics**: Handles Telegram forum topics as separate conversation rooms
- **Authorization**: Optional chat authorization controls
- **Rich Context**: Access to sender information, chat metadata, and message threading

#### Usage Example

Once configured, your agent will automatically connect to Telegram when started. The integration is enabled automatically when a `TELEGRAM_BOT_TOKEN` is detected.

```typescript
import { Agent } from '@tribesxyz/ayaos'

async function main() {
  const agent = new Agent()
  await agent.start()

  // Telegram integration is automatically active
  // Your agent will now respond to messages on Telegram
}
```

#### Advanced Configuration

You can access the Telegram manager programmatically:

```typescript
import { Agent } from '@tribesxyz/ayaos'

async function main() {
  const agent = new Agent()
  await agent.start()

  // Access the Telegram manager (if available)
  if (agent.telegram) {
    // Add custom command handlers
    agent.telegram.addCommandHandler('/start', async (ctx) => {
      await ctx.reply("Hello! I'm your AI agent.")
    })
  }
}
```

### XMTP Integration

XMTP (eXtensible Message Transport Protocol) provides decentralized, end-to-end encrypted messaging capabilities for your agent.

#### Prerequisites

Your agent needs access to an Ethereum wallet to use XMTP. This can be provided in two ways:

1. **Using the default wallet**: AyaOS automatically uses the agent's default EVM wallet
2. **Using a specific private key**: Provide a dedicated private key for XMTP

#### Configuration

**Option 1: Using Default Wallet (Recommended)**

No additional configuration needed. The agent will use its default EVM wallet for XMTP if available.

**Option 2: Using Specific Private Key**

```bash
# Optional: Dedicated private key for XMTP (hex format with 0x prefix)
XMTP_WALLET_PRIVATE_KEY=0x1234567890abcdef...
```

#### Features

The XMTP integration provides:

- **Decentralized Messaging**: Send and receive messages on the XMTP network
- **End-to-End Encryption**: All messages are automatically encrypted
- **Web3 Native**: Integrates seamlessly with Ethereum ecosystem
- **Cross-Platform**: Works with any XMTP-compatible client
- **Reply Support**: Full support for message threads and replies

#### Usage Example

```typescript
import { Agent } from '@tribesxyz/ayaos'

async function main() {
  const agent = new Agent()
  await agent.start()

  // XMTP integration is automatically active if wallet is available
  // Your agent will now send and receive messages on XMTP
}
```

#### Getting Started with XMTP

1. Ensure your agent has an EVM wallet configured
2. Start your agent - XMTP will initialize automatically
3. Other XMTP users can message your agent using its wallet address
4. Your agent will respond to incoming XMTP messages

#### Network Configuration

XMTP integration uses the production network by default. The service automatically:

- Creates an XMTP client with your wallet
- Sets up message persistence in a local database
- Handles message encoding/decoding including reply threading
- Manages connection lifecycle and error recovery

### Platform Status

You can verify which platforms are active by checking the console output when starting your agent:

```bash
bun dev
```

Look for messages like:

- `✅ Telegram client successfully started for character <name>`
- `✅ XMTP client started <agentId>`

## Next Steps

For more information about AyaOS and ElizaOS, please visit:

- [ElizaOS Documentation](https://eliza.how)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](LICENSE)
