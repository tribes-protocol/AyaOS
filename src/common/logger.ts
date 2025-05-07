import { isBigInt, isNull } from '@/common/functions'
import pino from 'pino'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function seralize(obj: any): any {
  if (isNull(obj)) {
    return obj
  }

  if (obj instanceof Error) {
    return pino.stdSerializers.errWithCause(obj)
  }

  // transform each item for arrays
  if (Array.isArray(obj)) {
    return obj.map(seralize)
  }

  // transform URLs to string
  if (obj instanceof URL) {
    return obj.toString()
  }

  // transform BigInt to string
  if (isBigInt(obj)) {
    return obj.toString()
  }

  // transfer BN to decimal string
  // if (BN.isBN(obj)) {
  //   return obj.toString(10)
  // }

  // return primitives and null/undefined unchanged
  if (typeof obj !== 'object') {
    return obj
  }

  // use toJSON() if available
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (typeof obj.toJSON === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return obj.toJSON()
  }

  // transform each value for objects
  return Object.fromEntries(Object.entries(obj).map(([key, val]) => [key, seralize(val)]))
}

// Custom fallback serializer for objects that don't match other serializers
const objectSerializer = (value: unknown): unknown => {
  return seralize(value)
}

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname'
    }
  },
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: objectSerializer,
    error: objectSerializer,
    arg: objectSerializer,
    args: objectSerializer
  }
})

/**
 * AyaLogger class that wraps pino logger with a more console-like interface
 * Allows multiple arguments and flips the parameter order for better usability
 */
class AyaLogger {
  /**
   * Internal helper method to log at specified level
   * @param level The log level to use
   * @param message The message string
   * @param args Additional arguments to log
   */
  private logAtLevel(
    level: 'info' | 'error' | 'warn' | 'debug' | 'trace',
    message: string,
    args?: unknown
  ): void {
    if (isNull(args)) {
      logger[level](message)
    } else {
      logger[level](args, message)
    }
  }

  /**
   * Log at 'info' level
   * @param message The message string
   * @param ...args Additional arguments to log
   */
  info(message: string, args?: unknown): void {
    this.logAtLevel('info', message, args)
  }

  /**
   * Log at 'error' level
   * @param message The message string
   * @param ...args Additional arguments to log
   */
  error(message: string, args?: unknown): void {
    this.logAtLevel('error', message, args)
  }

  /**
   * Log at 'warn' level
   * @param message The message string
   * @param ...args Additional arguments to log
   */
  warn(message: string, args?: unknown): void {
    this.logAtLevel('warn', message, args)
  }

  /**
   * Log at 'debug' level
   * @param message The message string
   * @param ...args Additional arguments to log
   */
  debug(message: string, args?: unknown): void {
    this.logAtLevel('debug', message, args)
  }

  /**
   * Log at 'trace' level
   * @param message The message string
   * @param ...args Additional arguments to log
   */
  trace(message: string, args?: unknown): void {
    this.logAtLevel('trace', message, args)
  }

  /**
   * Alias for info method to match console.log behavior
   * @param message The message string
   * @param ...args Additional arguments to log
   */
  log(message: string, args?: unknown): void {
    this.info(message, args)
  }
}

// Export a singleton instance
export const ayaLogger = new AyaLogger()
