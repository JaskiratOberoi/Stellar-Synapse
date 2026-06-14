import { EventEmitter } from 'node:events'
import type { ITransport } from './ITransport'
import type { InstrumentConnectionConfig } from '../../../shared/types'
import { logger } from '../logger'

/**
 * RS-232 serial transport (stub).
 *
 * Many analyzers still default to serial ASTM at 9600 baud. This stub defines
 * the contract; the real implementation will lazy-load `serialport` (an
 * optional native dependency) so the app still runs where it is unavailable.
 *
 * Wiring guide for the next phase:
 *   const { SerialPort } = await import('serialport')
 *   this.port = new SerialPort({ path, baudRate })
 *   this.port.on('data', (chunk) => this.emit('data', chunk))
 */
export class SerialTransport extends EventEmitter implements ITransport {
  readonly kind = 'serial'
  private running = false

  constructor(
    private readonly instrumentId: string,
    private readonly config: InstrumentConnectionConfig
  ) {
    super()
  }

  isRunning(): boolean {
    return this.running
  }

  async start(): Promise<void> {
    this.running = true
    const path = this.config.serialPath ?? 'COM1'
    const baud = this.config.baudRate ?? 9600
    logger.warn(
      'serial',
      `Serial transport is a scaffold stub (${path}@${baud}). Live serial I/O lands in a later phase.`
    )
    this.emit('status', 'listening')
  }

  async stop(): Promise<void> {
    this.running = false
    this.emit('status', 'offline')
  }

  write(_data: Buffer | string): void {
    // No-op in the stub.
  }
}
