import { compactMap } from '@/common/functions'
import type { Action, IAgentRuntime, Memory, Provider, State } from '@elizaos/core'
import { formatActionNames } from '@elizaos/core'

// Helper function to format a single action in markdown
const formatActionMD = (action: Action): string => {
  let actionMD = `## ${action.name}\n\n`

  // Add description
  actionMD += `### Description\n${action.description}\n\n`

  return actionMD
}

// Helper function to format all actions in markdown
const formatActionsMD = (actions: Action[]): string => {
  if (actions.length === 0) return ''

  const actionsMD = actions.map(formatActionMD).join('\n\n')
  return `# Available Actions\n\n${actionsMD}`
}

export const routerActionsProvider: Provider = {
  name: 'ROUTER_ACTIONS',
  description: 'Possible router actions',
  position: -2,
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
    const actionNames = `Possible actions: ${formatActionNames(actionsData)}`

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
