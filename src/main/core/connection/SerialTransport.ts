import { EventEmitter } from 'node:events'
import type { ITransport } from './ITransport'
import type { ConnectionStatus, InstrumentConnectionConfig } from '../../../shared/types'
import { logger } from '../logger'

/**
 * RS-232 serial transport.
 *
 * Lazy-loads `serialport` (an optional native dependency) so the app still runs
 * on machines where it is unavailable / not rebuilt for the platform — a load
 * failure degrades to an error status instead of crashing the process.
 *
 * Framing defaults to 8-N-1 but is configurable: the Beckman AU "Online" host
 * link, for example, is 7 data bits / no parity / 1 stop bit at 9600 baud.
 *
 * Auto-reopens with capped backoff so the link survives the serial port
 * disappearing (USB adapter unplug, analyzer/PC reboot).
 */

// Minimal shape of the bits of `serialport` we use (avoids a hard type dep).
interface SerialPortLike extends EventEmitter {
  isOpen: boolean
  open(cb?: (err: Error | null) => void): void
  close(cb?: (err: Error | null) => void): void
  write(data: Buffer | string, cb?: (err: Error | null | undefined) => void): boolean
  /** Assert modem control lines. Some adapters/devices ignore RX until DTR/RTS are high. */
  set?(opts: { dtr?: boolean; rts?: boolean; brk?: boolean }, cb?: (err: Error | null) => void): void
  /** Resolves once the OS has pushed the write buffer out of the UART. */
  drain?(cb?: (err: Error | null | undefined) => void): void
}

export class SerialTransport extends EventEmitter implements ITransport {
  readonly kind = 'serial'
  private port: SerialPortLike | null = null
  private running = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private backoffMs = 2000
  private readonly maxBackoffMs = 30000

  constructor(
    private readonly instrumentId: string,
    private readonly config: InstrumentConnectionConfig
  ) {
    super()
  }

  private get passive(): boolean {
    return !!this.config.passive
  }

  isRunning(): boolean {
    return this.running
  }

  async start(): Promise<void> {
    this.running = true
    await this.openPort()
  }

  private async openPort(): Promise<void> {
    if (!this.running) return
    const path = this.config.serialPath ?? 'COM1'
    const baudRate = this.config.baudRate ?? 9600
    const dataBits = this.config.dataBits ?? 8
    const parity = this.config.parity ?? 'none'
    const stopBits = this.config.stopBits ?? 1
    const framing = `${dataBits}${parity[0].toUpperCase()}${stopBits}`

    let SerialPortCtor: new (opts: Record<string, unknown>) => SerialPortLike
    try {
      type Sp = { SerialPort: new (opts: Record<string, unknown>) => SerialPortLike }
      const mod = (await import('serialport')) as unknown as Sp & { default?: Sp }
      // Tolerate CJS↔ESM interop: the named export may sit under `.default` in
      // the packaged ESM build, where `mod.SerialPort` would otherwise be
      // undefined and `new undefined(...)` would throw.
      SerialPortCtor = mod.SerialPort ?? mod.default?.SerialPort
      if (!SerialPortCtor) throw new Error('SerialPort export not found')
    } catch (err) {
      logger.error(
        'serial',
        `Failed to load 'serialport' native module: ${(err as Error).message}. ` +
          `Rebuild it for this platform (electron-rebuild) to use serial transports.`
      )
      this.emitStatus('error')
      return
    }

    this.emitStatus('connecting')
    const port = new SerialPortCtor({ path, baudRate, dataBits, parity, stopBits, autoOpen: false })
    this.port = port

    port.on('data', (chunk: Buffer) => this.emit('data', chunk))
    port.on('error', (err: Error) => {
      logger.warn('serial', `${path} error: ${err.message}`)
      this.emit('error', err)
    })
    port.on('close', () => {
      this.port = null
      if (this.running) {
        this.emitStatus('connecting')
        this.scheduleReopen()
      }
    })

    port.open((err) => {
      if (err) {
        logger.warn('serial', `Could not open ${path}@${baudRate} ${framing}: ${err.message}`)
        this.port = null
        if (this.running) this.scheduleReopen()
        return
      }
      this.backoffMs = 2000
      logger.info(
        'serial',
        `Opened ${path}@${baudRate} ${framing}${this.passive ? ' (passive read-only)' : ''} (${this.instrumentId})`
      )
      // Explicitly raise DTR/RTS on an active link. Several USB/PCIe adapters
      // leave these low until asked, and a device that watches them will ignore
      // everything we transmit — the link then looks receive-only: we see the
      // analyzer fine, it never sees our ACKs. Harmless when already asserted.
      if (!this.passive && typeof port.set === 'function') {
        port.set({ dtr: true, rts: true }, (err) => {
          if (err) logger.warn('serial', `${path}: could not assert DTR/RTS: ${err.message}`)
          else logger.info('serial', `${path}: DTR/RTS asserted (TX enabled)`)
        })
      }
      this.emitStatus('online', `${path}@${baudRate}`)
    })
  }

  private scheduleReopen(): void {
    if (this.reconnectTimer) return
    const delay = this.backoffMs
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs)
      void this.openPort()
    }, delay)
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.port?.isOpen) this.port.close()
    this.port = null
    this.emitStatus('offline')
  }

  write(data: Buffer | string): void {
    if (this.passive) {
      logger.warn('serial', `Suppressed write on passive serial tap (${this.instrumentId})`)
      return
    }
    const port = this.port
    if (!port?.isOpen) {
      logger.warn('serial', `Dropped ${data.length}B write — port not open (${this.instrumentId})`)
      return
    }
    // Report write/flush failures instead of swallowing them: when an analyzer
    // behaves as if it never receives us, the first question is whether the bytes
    // even left this machine. A clean drain means they reached the UART — i.e.
    // any remaining fault is in the cable/adapter, not here.
    port.write(data, (err) => {
      if (err) logger.warn('serial', `${this.config.serialPath}: write failed: ${err.message}`)
      else if (typeof port.drain === 'function') {
        port.drain((derr) => {
          if (derr) logger.warn('serial', `${this.config.serialPath}: drain failed: ${derr.message}`)
        })
      }
    })
  }

  private emitStatus(status: ConnectionStatus, peer?: string): void {
    this.emit('status', status, peer)
  }
}
