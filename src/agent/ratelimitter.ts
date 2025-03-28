import type { Memory, UUID } from '@elizaos/core'
import { Interval, RateLimiter as Limiter } from 'limiter'
import { LRUCache } from 'lru-cache'

/**
 * Configuration options for rate limiting
 */
export interface RateLimiterOptions {
  /** Number of tokens per interval */
  tokensPerInterval: number
  /** The time interval in milliseconds or 'second', 'minute', 'hour', 'day' */
  interval: Interval
}

/**
 * RateLimiter class to manage rate limits for API requests
 * Provides per-user rate limiting
 */
export class RateLimiter {
  private userLimiters: LRUCache<string, Limiter> = new LRUCache({ max: 1000000 })
  private options: RateLimiterOptions

  /**
   * Creates a new RateLimiter instance
   * @param options Rate limiting configuration
   */
  constructor(options: RateLimiterOptions) {
    this.options = options
  }

  /**
   * Check if a request can be processed or should be rate limited
   * @param memory The Memory object containing user information
   * @returns Promise that resolves to true if request is allowed, false if rate limited
   */
  async canProcess(memory: Memory): Promise<boolean> {
    const limiter = this.getLimiterForUser(memory.userId)

    // Try to remove a token (consume 1 request)
    // If fireImmediately is true, this will return remaining tokens count
    // which could be negative if rate limited
    const remainingTokens = await limiter.removeTokens(1)
    return remainingTokens >= 0
  }

  /**
   * Get or create a rate limiter for a specific user
   * @param userId User identifier
   * @returns Rate limiter for the user
   */
  private getLimiterForUser(userId: UUID): Limiter {
    const limiter = this.userLimiters.get(userId)
    if (limiter) {
      return limiter
    }

    const newLimiter = new Limiter({
      tokensPerInterval: this.options.tokensPerInterval,
      interval: this.options.interval,
      fireImmediately: true
    })

    this.userLimiters.set(userId, newLimiter)
    return newLimiter
  }

  /**
   * Reset rate limiter for a specific user
   * @param userId User identifier
   */
  resetUserRateLimit(userId: UUID): void {
    if (this.userLimiters.has(userId)) {
      this.userLimiters.delete(userId)
    }
  }

  /**
   * Reset all rate limiters (per-user)
   */
  resetAllRateLimits(): void {
    this.userLimiters.clear()
  }
}

export default RateLimiter
