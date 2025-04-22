import { compactMap } from '@/common/functions'
import type { Action, IAgentRuntime, Memory, Provider, State } from '@elizaos/core'
import { formatActionNames } from '@elizaos/core'

// Helper function to format action examples in markdown
const formatActionExamplesMD = (action: Action): string => {
  if (!action.examples || action.examples.length === 0) {
    return ''
  }

  const examplesMD = action.examples
    .map((example, index) => {
      let exampleMD = `### Example ${index + 1}\n\n`

      // Process each message in the example
      for (let i = 0; i < example.length; i++) {
        const message = example[i]
        const isAgent = message.name.includes('{{name2}}') || message.name.includes('{{agentName}}')
        const speaker = isAgent ? 'Agent' : 'User'

        exampleMD += `**${speaker}**: ${message.content.text || ''}\n`
        if (message.content.actions && message.content.actions.length > 0) {
          exampleMD += `(actions: ${message.content.actions.join(', ')})\n`
        }
        exampleMD += '\n'
      }

      return exampleMD
    })
    .join('\n')

  return `### Examples\n\n${examplesMD}`
}

// Helper function to format a single action in markdown
const formatActionMD = (action: Action): string => {
  let actionMD = `## ${action.name}\n\n`

  // Add description
  actionMD += `### Description\n${action.description}\n\n`

  // Add examples if they exist
  actionMD += formatActionExamplesMD(action)

  return actionMD
}

// Helper function to format all actions in markdown
const formatActionsMD = (actions: Action[]): string => {
  if (actions.length === 0) return ''

  const actionsMD = actions.map(formatActionMD).join('\n\n')
  return `# Available Actions\n\n${actionsMD}`
}

export const actionsProvider: Provider = {
  name: 'ACTIONS',
  description: 'Possible response actions',
  position: -1,
  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    // Get actions that validate for this message
    const actionPromises = runtime.actions.map(async (action: Action) => {
      const result = await action.validate(runtime, message, state)
      if (result) {
        return action
      }
      return null
    })

    const resolvedActions = await Promise.all(actionPromises)

    const actionsData = compactMap(resolvedActions)

    // Format action-related texts
    const actionNames = `Possible response actions: ${formatActionNames(actionsData)}`

    // Format actions in markdown structure
    const actions = formatActionsMD(actionsData)

    const data = {
      actionsData
    }

    const values = {
      actions,
      actionNames
    }

    // Combine all text sections
    const text = `${actionNames}\n\n${actions}`

    return {
      data,
      values,
      text
    }
  }
}
