import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { appendFile } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry, LogLevel } from '../../shared/types'

/**
 * In-memory ring-buffer logger with an event emitter so the UI can stream logs
 * live. When a log directory is configured (see initFile), entries are also
 * appended to a daily file so logs survive restarts and can live off the C:
 * drive (the data directory chosen at install time).
 */
class Logger extends EventEmitter {
  private buffer: LogEntry[] = []
  private readonly max = 500
  private logDir: string | null = null

  /** Enable persistent file logging into the given directory. */
  initFile(dir: string): void {
    this.logDir = dir
    this.info('logger', `File logging enabled at ${dir}`)
  }

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
    // Append to the daily log file (best-effort, never throws into callers).
    if (this.logDir) {
      const file = join(this.logDir, `synapse-${entry.timestamp.slice(0, 10)}.log`)
      appendFile(file, `${entry.timestamp} [${level.toUpperCase()}] [${source}] ${message}\n`, () => {})
    }
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
