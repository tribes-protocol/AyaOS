import { toJsonTree } from '@/common/functions'
import pino from 'pino'

// Custom fallback serializer for objects that don't match other serializers
const objectSerializer = (value: unknown): unknown => {
  if (value instanceof Error) {
    return pino.stdSerializers.errWithCause(value)
  } else if (value && typeof value === 'object') {
    return toJsonTree(value)
  }
  return value // Return primitives as is
}

export const ayaLogger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname'
    }
  },
  serializers: {
    '*': objectSerializer
  }
})
