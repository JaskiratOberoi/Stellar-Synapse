import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { LogEntry, LogLevel } from '../../shared/types'

/**
 * In-memory ring-buffer logger with an event emitter so the UI can stream logs
 * live. In a later phase this can also persist to disk.
 */
class Logger extends EventEmitter {
  private buffer: LogEntry[] = []
  private readonly max = 500

  log(level: LogLevel, source: string, message: string): void {
    const entry: LogEntry = {
      id: randomUUID(),
      level,
      source,
      message,
      timestamp: new Date().toISOString()
    }
    this.buffer.push(entry)
    if (this.buffer.length > this.max) this.buffer.shift()
    this.emit('log', entry)
    // Mirror to the dev console for convenience.
    const tag = `[${source}]`
    if (level === 'error') console.error(tag, message)
    else if (level === 'warn') console.warn(tag, message)
    else console.log(tag, message)
  }

  debug(source: string, message: string): void {
    this.log('debug', source, message)
  }
  info(source: string, message: string): void {
    this.log('info', source, message)
  }
  warn(source: string, message: string): void {
    this.log('warn', source, message)
  }
  error(source: string, message: string): void {
    this.log('error', source, message)
  }

  recent(): LogEntry[] {
    return [...this.buffer].reverse()
  }
}

export const logger = new Logger()
