import { isNull } from '@/common/functions'
import { Queue } from '@/common/lang/queue'

export class OperationQueue {
  readonly name: string
  private running = 0
  private queue = new Queue<() => Promise<void>>()
  private emptyListeners: (() => void)[] = []
  private logTime = false

  constructor(
    readonly maxConcurrent: number = 1,
    options: { name?: string; logTime?: boolean } = {}
  ) {
    this.name = options.name || '<no name>'
    this.logTime = options.logTime || false
  }

  async submit<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const startTime: number | undefined = this.logTime ? performance.now() : undefined
          resolve(await work())
          if (startTime) {
            console.log(`Operation [${this.name}] took ${performance.now() - startTime} ms`)
          }
        } catch (err) {
          reject(err)
        }
      })
      void this.doNextWork()
    })
  }

  private async doNextWork(): Promise<void> {
    if (this.running >= this.maxConcurrent) {
      return
    }

    const work = this.queue.pop()
    if (isNull(work)) {
      this.checkIfEmptyAndNotify()
      return
    }

    this.running++
    try {
      await work()
    } catch (err) {
      console.error('Exception in work(), this should never happen', err)
    } finally {
      this.running--
      void this.doNextWork()
    }
  }

  async size(): Promise<number> {
    return this.queue.size
  }

  async waitUntilFinished(): Promise<void> {
    return new Promise((resolve) => {
      if (this.queue.isEmpty() && this.running === 0) {
        resolve()
      } else {
        this.emptyListeners.push(resolve)
      }
    })
  }

  private checkIfEmptyAndNotify(): void {
    if (this.queue.isEmpty() && this.running === 0) {
      while (this.emptyListeners.length) {
        const listener = this.emptyListeners.pop()
        if (listener) listener()
      }
    }
  }
}
