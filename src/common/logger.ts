import { toJsonTree } from '@/common/functions'
import pino from 'pino'

// Custom levels with additional utility levels
const customLevels = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  log: 29,
  progress: 28,
  success: 27,
  debug: 20,
  trace: 10
}

// Custom fallback serializer for objects that don't match other serializers
const objectSerializer = (value: unknown): unknown => {
  if (value instanceof Error) {
    return pino.stdSerializers.errWithCause(value)
  } else if (value && typeof value === 'object') {
    return toJsonTree(value)
  }
  return value // Return primitives as is
}

// Determine if we should use pretty printing or raw JSON
const useJsonFormat = process.env.LOG_JSON_FORMAT === 'true'
const logLevel = process.env.DEFAULT_LOG_LEVEL || 'info'

// Configure the logger
const loggerOptions = {
  level: logLevel,
  customLevels,
  serializers: {
    err: pino.stdSerializers.errWithCause,
    '*': objectSerializer // Fallback serializer for any value
  },
  transport: useJsonFormat
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname'
        }
      }
}

// Create and export the logger
export const ayaLogger = pino(loggerOptions)

// // Helper function to properly log errors in a way that serializes them correctly
// export function logError(message: string, error: unknown): void {
//   ayaLogger.error({ err: error }, message)
// }

// // Helper function to log objects using toJsonTree
// export function logObject(message: string, obj: unknown): void {
//   const serialized = toJsonTree(obj)
//   ayaLogger.info({ obj: serialized }, message)
// }

export default ayaLogger
