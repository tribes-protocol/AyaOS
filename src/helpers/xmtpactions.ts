import {
  type ContentCodec,
  ContentTypeId,
  type EncodedContent
} from '@xmtp/content-type-primitives'
import { z } from 'zod'

/**
 * Content Type ID for Actions messages
 * Following XIP-67 specification for inline actions
 */
export const ContentTypeActions = new ContentTypeId({
  authorityId: 'coinbase.com',
  typeId: 'actions',
  versionMajor: 1,
  versionMinor: 0
})

/**
 * Individual action definition
 */
export type Action = {
  /** Unique identifier for this action */
  id: string
  /** Display text for the button */
  label: string
  /** Optional image URL */
  imageUrl?: string
  /** Optional visual style (primary|secondary|danger) */
  style?: 'primary' | 'secondary' | 'danger'
  /** Optional ISO-8601 expiration timestamp */
  expiresAt?: string
}

/**
 * Actions content structure
 * Agents use this to present interactive button options to users
 */

export const ActionsContentSchema = z.object({
  /** Unique identifier for these actions */
  id: z.string(),
  /** Descriptive text explaining the actions */
  description: z.string(),
  /** Array of action definitions */
  actions: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      imageUrl: z.string().url().optional(),
      style: z.enum(['primary', 'secondary', 'danger']).optional(),
      expiresAt: z.string().datetime().optional()
    })
  ),
  /** Optional ISO-8601 expiration timestamp */
  expiresAt: z.string().datetime().optional()
})

export type ActionsContent = z.infer<typeof ActionsContentSchema>

/**
 * Actions codec for encoding/decoding Actions messages
 * Implements XMTP ContentCodec interface for Actions content type
 */
export class ActionsCodec implements ContentCodec<ActionsContent> {
  get contentType(): ContentTypeId {
    return ContentTypeActions
  }

  encode(content: ActionsContent): EncodedContent {
    // Validate content before encoding
    this.validateContent(content)

    return {
      type: ContentTypeActions,
      parameters: { encoding: 'UTF-8' },
      content: new TextEncoder().encode(JSON.stringify(content))
    }
  }

  decode(content: EncodedContent): ActionsContent {
    const encoding = content.parameters.encoding
    if (encoding && encoding !== 'UTF-8') {
      throw new Error(`unrecognized encoding ${encoding}`)
    }

    const decodedContent = new TextDecoder().decode(content.content)
    try {
      const parsed = ActionsContentSchema.parse(JSON.parse(decodedContent))
      this.validateContent(parsed)
      return parsed
    } catch (error) {
      throw new Error(`Failed to decode Actions content: ${error}`)
    }
  }

  fallback(content: ActionsContent): string {
    const actionList = content.actions
      .map((action, index) => `[${index + 1}] ${action.label}`)
      .join('\n')
    return `${content.description}\n\n${actionList}\n\nReply with the number to select`
  }

  shouldPush(): boolean {
    return true
  }

  /**
   * Validates Actions content according to XIP-67 specification
   */
  private validateContent(content: ActionsContent): void {
    if (!content.id || typeof content.id !== 'string') {
      throw new Error('Actions.id is required and must be a string')
    }

    if (!content.description || typeof content.description !== 'string') {
      throw new Error('Actions.description is required and must be a string')
    }

    if (!Array.isArray(content.actions) || content.actions.length === 0) {
      throw new Error('Actions.actions is required and must be a non-empty array')
    }

    if (content.actions.length > 10) {
      throw new Error('Actions.actions cannot exceed 10 actions for UX reasons')
    }

    // Validate each action
    content.actions.forEach((action, index) => {
      if (!action.id || typeof action.id !== 'string') {
        throw new Error(`Action[${index}].id is required and must be a string`)
      }

      if (!action.label || typeof action.label !== 'string') {
        throw new Error(`Action[${index}].label is required and must be a string`)
      }

      if (action.label.length > 50) {
        throw new Error(`Action[${index}].label cannot exceed 50 characters`)
      }

      if (action.style && !['primary', 'secondary', 'danger'].includes(action.style)) {
        throw new Error(`Action[${index}].style must be one of: primary, secondary, danger`)
      }

      if (action.expiresAt && !this.isValidISO8601(action.expiresAt)) {
        throw new Error(`Action[${index}].expiresAt must be a valid ISO-8601 timestamp`)
      }
    })

    // Check for duplicate action IDs
    const actionIds = content.actions.map((action) => action.id)
    const uniqueActionIds = new Set(actionIds)
    if (actionIds.length !== uniqueActionIds.size) {
      throw new Error('Action.id values must be unique within Actions.actions array')
    }

    if (content.expiresAt && !this.isValidISO8601(content.expiresAt)) {
      throw new Error('Actions.expiresAt must be a valid ISO-8601 timestamp')
    }
  }

  /**
   * Basic ISO-8601 timestamp validation
   */
  private isValidISO8601(timestamp: string): boolean {
    try {
      const date = new Date(timestamp)
      return date.toISOString() === timestamp
    } catch {
      return false
    }
  }
}

/**
 * Content Type ID for Intent messages
 * Following XIP-67 specification for inline actions
 */
export const ContentTypeIntent = new ContentTypeId({
  authorityId: 'coinbase.com',
  typeId: 'intent',
  versionMajor: 1,
  versionMinor: 0
})

/**
 * Intent content structure
 * Users express their selection by sending Intent messages when they tap action buttons
 */
export const IntentContentSchema = z.object({
  /** References Actions.id - provides strong coupling with Actions message */
  id: z.string(),
  /** References specific Action.id - indicates which action was selected */
  actionId: z.string(),
  /** Optional context data for the selection */
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
})

export type IntentContent = z.infer<typeof IntentContentSchema>

/**
 * Intent codec for encoding/decoding Intent messages
 * Implements XMTP ContentCodec interface for Intent content type
 */
export class IntentCodec implements ContentCodec<IntentContent> {
  get contentType(): ContentTypeId {
    return ContentTypeIntent
  }

  encode(content: IntentContent): EncodedContent {
    // Validate content before encoding
    this.validateContent(content)

    return {
      type: ContentTypeIntent,
      parameters: { encoding: 'UTF-8' },
      content: new TextEncoder().encode(JSON.stringify(content))
    }
  }

  decode(content: EncodedContent): IntentContent {
    const encoding = content.parameters.encoding
    if (encoding && encoding !== 'UTF-8') {
      throw new Error(`unrecognized encoding ${encoding}`)
    }

    const decodedContent = new TextDecoder().decode(content.content)
    try {
      const parsed = IntentContentSchema.parse(JSON.parse(decodedContent))
      this.validateContent(parsed)
      return parsed
    } catch (error) {
      throw new Error(`Failed to decode Intent content: ${error}`)
    }
  }

  fallback(content: IntentContent): string {
    return `User selected action: ${content.actionId}`
  }

  shouldPush(): boolean {
    return true
  }

  /**
   * Validates Intent content according to XIP-67 specification
   */
  private validateContent(content: IntentContent): void {
    if (!content.id || typeof content.id !== 'string') {
      throw new Error('Intent.id is required and must be a string')
    }

    if (!content.actionId || typeof content.actionId !== 'string') {
      throw new Error('Intent.actionId is required and must be a string')
    }

    // Validate metadata if provided
    if (content.metadata !== undefined) {
      if (
        typeof content.metadata !== 'object' ||
        content.metadata === null ||
        Array.isArray(content.metadata)
      ) {
        throw new Error('Intent.metadata must be an object if provided')
      }

      // Check for reasonable metadata size to avoid XMTP content limits
      const metadataString = JSON.stringify(content.metadata)
      if (metadataString.length > 10000) {
        // 10KB limit for metadata
        throw new Error('Intent.metadata is too large (exceeds 10KB limit)')
      }
    }
  }
}
