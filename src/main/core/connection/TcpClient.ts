import { EventEmitter } from 'node:events'
import net from 'node:net'
import type { ITransport } from './ITransport'
import type { InstrumentConnectionConfig, ConnectionStatus } from '../../../shared/types'
import { logger } from '../logger'

/**
 * TCP client transport. The middleware dials the analyzer at host:port and
 * reads its result stream.
 *
 * Passive mode (`config.passive`): a strictly read-only tap. We connect and
 * listen only - no bytes are ever written back to the device (no ACK, ENQ, or
 * host-query). This lets Stellar Synapse import data from a live analyzer
 * without participating in or disturbing any existing LIS conversation.
 *
 * Auto-reconnects with capped backoff so a tap survives analyzer reboots and
 * idle disconnects.
 */
export class TcpClient extends EventEmitter implements ITransport {
  readonly kind = 'tcp-client'
  private socket: net.Socket | null = null
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
    this.connect()
  }

  private connect(): void {
    if (!this.running) return
    const port = this.config.port ?? 9100
    const host = this.config.host ?? '127.0.0.1'
    const mode = this.passive ? 'passive read-only tap' : 'client'

    this.emitStatus('connecting')
    const socket = new net.Socket()
    this.socket = socket

    socket.on('connect', () => {
      this.backoffMs = 2000
      const peer = `${host}:${port}`
      logger.info('tcp-client', `Connected to ${peer} as ${mode} (${this.instrumentId})`)
      socket.setKeepAlive(true, 10000)
      socket.setNoDelay(true)
      this.emitStatus('online', peer)
    })
    socket.on('data', (chunk) => this.emit('data', chunk))
    socket.on('error', (err) => {
      logger.warn('tcp-client', `${host}:${port} error: ${err.message}`)
      this.emit('error', err)
    })
    socket.on('close', () => {
      this.socket = null
      if (this.running) {
        this.emitStatus('connecting')
        this.scheduleReconnect()
      }
    })

    socket.connect(port, host)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = this.backoffMs
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs)
      this.connect()
    }, delay)
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket?.destroy()
    this.socket = null
    this.emitStatus('offline')
  }

  write(data: Buffer | string): void {
    if (this.passive) {
      // Read-only tap: never transmit to the device.
      logger.warn('tcp-client', `Suppressed write on passive tap (${this.instrumentId})`)
      return
    }
    if (this.socket && !this.socket.destroyed) this.socket.write(data)
  }

  /** Drop and re-open the socket while staying in the running state. */
  forceReconnect(): void {
    if (!this.running) return
    this.backoffMs = 2000
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket?.destroy()
    this.socket = null
    this.connect()
  }

  private emitStatus(status: ConnectionStatus, peer?: string): void {
    this.emit('status', status, peer)
  }
}
