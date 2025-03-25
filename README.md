# AyaOS

AyaOS is a high-level framework built on top of ElizaOS for creating autonomous AI agents. It provides a simple yet powerful interface for building, customizing, and deploying AI agents with advanced capabilities.

## Quick Start

### Prerequisites

- Node.js 20 or higher

### Installation

Choose one of these two options to get started:

#### Option 1: Clone the Agent Template (recommended)

You can clone our agent template repository.
This template comes with prettier, eslint, github workflows all setup so its recommended to use this template.

```bash
git clone https://github.com/tribes-protocol/agent
cd agent
```

Install dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

#### Option 2: Add to existing project

Create a new directory for your project and initialize it:

```bash
mkdir my-aya-agent
cd my-aya-agent
bun init -y # or npm init -y
```

Install AyaOS:

```bash
bun add @tribesxyz/ayaos # or npm install @tribesxyz/ayaos
bun add -D tsx
```

Add a script to your package.json to run the agent:

```json
"scripts": {
  "dev": "tsx src/index.ts"
}
```

#### Set Environment Variables

Create a `.env` file in the root directory with the following required variables:

```bash
USE_OPENAI_EMBEDDING=true # or false if you want to use a different embedding provider

# API keys for various providers (if needed)
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

### Creating Your First Agent

Create a file at `src/index.ts` (or edit the existing one if you cloned the template) with the following code:

```typescript
import { Agent, ayaLogger } from '@tribesxyz/ayaos'

async function main() {
  // Create a new agent
  const agent = new Agent({
    dataDir: 'data' // default data directory
  })

  // Pre-LLM handler - executed before sending context to the LLM
  agent.on('pre:llm', async (context) => {
    ayaLogger.info('Processing before LLM:', context.memory?.content)
    // Return true to continue execution, false to stop
    return true
  })

  // Start the agent
  await agent.start()

  ayaLogger.info('Agent started with ID:', agent.agentId)
}

main().catch(ayaLogger.error)
```

### Running Your Agent

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

When running for the first time, you'll see a URL in the terminal. Visit this URL to authenticate and complete the agent registration process. After successful authentication, your agent will be provisioned and ready to use.

## Agent Architecture

AyaOS extends ElizaOS with a set of abstractions designed to build sophisticated autonomous agents. The following sections detail each component of the architecture.

### Agent Lifecycle

AyaOS agents follow a specific processing flow. Understanding this flow is crucial for developing effective agents:

```
pre:llm → LLM processing → post:llm → (optional) pre:action → action execution → post:action
```

Each step in the lifecycle can be intercepted and modified using event handlers.

### Event Handlers

Event handlers allow you to intercept and modify the agent's behavior at different points in its processing flow:

```typescript
// Pre-LLM handler - executed before sending context to the LLM
agent.on('pre:llm', async (context) => {
  // Modify the context before it's sent to the LLM
  return true // Return true to continue execution, false to stop
})

// Post-LLM handler - executed after receiving response from the LLM
agent.on('post:llm', async (context) => {
  // Process the LLM response
  return true
})

// Pre-action handler - executed before an action is performed
agent.on('pre:action', async (context) => {
  // Validate or modify action parameters
  return true
})

// Post-action handler - executed after an action is performed
agent.on('post:action', async (context) => {
  // Process action results
  return true
})
```

Each handler receives a context object containing:

- `memory`: The current memory being processed
- `responses`: Previous responses
- `state`: Current agent state
- `content`: Content being processed

Returning `false` from any handler stops the execution flow, providing control over the agent's behavior.

### Data Directory

AyaOS stores agent configuration, credentials, and other persistent data in a dedicated directory. It is recommended to use the `data` directory in the root of your project.

```typescript
const agent = new Agent({
  dataDir: 'data'
})
```

The data directory contains the following files:

- `character.json`: The agent's character configuration
- `agent-keypair.json`: The agent's cryptographic keys
- `registration.json`: Temporary registration data (removed after successful provisioning)

### Agent Provisioning

When you start an agent for the first time, it goes through a provisioning process:

1. A keypair is generated for secure communication
2. A CLI authentication flow is initiated (requires user action)
3. The agent connects to the platform
4. A character is created and stored in the data directory

This process ensures secure and authenticated agent creation with proper identity management.

## Core Abstractions

AyaOS extends ElizaOS with several core abstractions:

### Actions

Actions are tools your agent can use to perform specific tasks. They follow a JSON Schema format for parameters and return results.

```typescript
import type { Action, Content, HandlerCallback, IAyaRuntime, Memory, State } from '@tribesxyz/ayaos'
import { ayaLogger, composeContext, generateObject, ModelClass } from '@tribesxyz/ayaos'
import { z } from 'zod'

const SentimentAnalysisResultSchema = z.object({
  sentiment: z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL']),
  confidence: z.number().min(0).max(1),
  explanation: z.string()
})

export interface SentimentAnalysisContent extends Content {
  sentiment: string
  confidence: number
  explanation: string
}

const sentimentAnalysisTemplate = `
You are a sentiment analysis engine that evaluates text and determines its emotional tone.

Your job is to analyze the text and respond with:
- sentiment: one of ["POSITIVE", "NEGATIVE", "NEUTRAL"]
- confidence: how confident you are in your analysis (0-1)
- explanation: a brief explanation of your reasoning

Text to analyze:
{{text}}

Respond with a JSON object.
`

export const analyzeSentimentAction: Action = {
  name: 'ANALYZE_SENTIMENT',
  similes: ['EVALUATE_TONE', 'DETECT_EMOTION'],
  description: 'Analyzes the sentiment of a text using the LLM',
  validate: async () => true,
  handler: async (
    runtime: IAyaRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<boolean> => {
    ayaLogger.info('Starting ANALYZE_SENTIMENT handler...')

    if (!state) {
      state = await runtime.composeState(message)
    } else {
      state = await runtime.updateRecentMessageState(state)
    }

    // Extract the text to analyze from the message or options
    const textToAnalyze = options?.text || message.content?.text || ''

    const context = composeContext({
      state,
      template: sentimentAnalysisTemplate,
      variables: { text: textToAnalyze }
    })

    const raw = (
      await generateObject({
        runtime,
        context,
        modelClass: ModelClass.LARGE,
        schema: SentimentAnalysisResultSchema
      })
    ).object

    const sentimentResult = SentimentAnalysisResultSchema.parse(raw)

    if (callback) {
      await callback({
        text: `Sentiment analysis completed ✅: ${JSON.stringify(sentimentResult, null, 2)}`,
        content: sentimentResult
      })
    }

    return true
  },
  examples: [
    [
      {
        user: '{{user1}}',
        content: {
          text: 'I absolutely love this new product! It has changed my life for the better.'
        }
      },
      {
        user: '{{user2}}',
        content: {
          action: 'ANALYZE_SENTIMENT',
          text: 'Sentiment analysis completed ✅'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: {
          text: 'This experience was terrible. I will never use this service again.'
        }
      },
      {
        user: '{{user2}}',
        content: {
          action: 'ANALYZE_SENTIMENT',
          text: 'Sentiment analysis completed ✅'
        }
      }
    ],
    [
      {
        user: '{{user1}}',
        content: {
          text: 'The package arrived on time. It contained all the items I ordered.'
        }
      },
      {
        user: '{{user2}}',
        content: {
          action: 'ANALYZE_SENTIMENT',
          text: 'Sentiment analysis completed ✅'
        }
      }
    ]
  ]
}

async function main() {
  const agent = new Agent()

  // Register the sentiment analysis action
  agent.register('action', sentimentAnalysisAction)

  await agent.start()

  // Now the agent can use the sentiment analysis action when needed
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
    console.log('Weather:', weather)
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

## Security and Authentication

AyaOS uses secure cryptographic methods to authenticate and secure your agent:

### Key Pair Generation

On first run, the agent generates a secure elliptic curve (P-256) key pair for:

- Signing messages
- Authenticating with the platform
- Securely storing sensitive information

The key pair is stored in the agent's data directory (`agent-keypair.json`) with restricted permissions (read/write for owner only).

### Encryption

Sensitive information in the character configuration (marked with `AGENTCOIN_ENC_` prefix) is automatically decrypted at runtime using the agent's private key.

### Authentication Flow

The authentication process follows these steps:

1. A CLI auth request is created
2. The user visits the provided URL to authenticate
3. The authentication token is securely stored
4. The agent uses this token for further API calls

This ensures that only authorized users can create and manage agents.

## Advanced Usage Examples

### Creating an Agent with Custom Model Configuration

```typescript
import { Agent } from '@tribesxyz/ayaos'

async function main() {
  const agent = new Agent({
    modelConfig: {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      endpoint: 'https://api.anthropic.com/v1/messages'
    },
    dataDir: './custom-agent-data'
  })

  await agent.start()
}
```

### Building an Agent with Advanced Knowledge Management

```typescript
import { Agent, ensureUUID } from '@tribesxyz/ayaos'
import { v4 as uuidv4 } from 'uuid'

async function main() {
  const agent = new Agent()
  await agent.start()

  // Add knowledge items with unique IDs
  await Promise.all([
    agent.knowledge.add(ensureUUID(uuidv4()), {
      text: 'AyaOS is a framework for building autonomous agents.',
      metadata: {
        source: 'documentation',
        type: 'concept'
      }
    }),
    agent.knowledge.add(ensureUUID(uuidv4()), {
      text: 'ElizaOS provides the foundation for agent operations.',
      metadata: {
        source: 'documentation',
        type: 'concept'
      }
    })
  ])

  // Search the knowledge base
  const results = await agent.knowledge.search({
    q: 'What is AyaOS?',
    limit: 3
  })

  console.log('Knowledge search results:', results)
}
```

## Troubleshooting

### Common Issues

#### Agent fails to provision

Ensure your internet connection is stable and you've completed the authentication process by visiting the URL shown in the terminal.

#### API key issues

If using external model providers, ensure the respective API keys are correctly set in your environment variables.

### Debugging

To enable debug logging, set the `ELIZA_LOG_LEVEL` environment variable:

```bash
ELIZA_LOG_LEVEL=debug npm run dev
```

This will provide more detailed logs about the agent's operations.

## Next Steps

For more information about AyaOS and ElizaOS, please visit:

- [ElizaOS Documentation](https://eliza.how)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](LICENSE)
