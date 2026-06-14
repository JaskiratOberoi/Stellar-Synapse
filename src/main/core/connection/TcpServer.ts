import { EventEmitter } from 'node:events'
import net from 'node:net'
import type { ITransport } from './ITransport'
import type { InstrumentConnectionConfig, ConnectionStatus } from '../../../shared/types'
import { logger } from '../logger'

/**
 * TCP server transport.
 *
 * Research note: most analyzers (e.g. Beckman Coulter DxH, Maglumi over TCP)
 * act as the TCP *client* and connect outward to the LIS/middleware, so the
 * middleware must be the TCP *server* that listens on a port. This class
 * accepts an inbound analyzer connection and relays raw bytes.
 */
export class TcpServer extends EventEmitter implements ITransport {
  readonly kind = 'tcp-server'
  private server: net.Server | null = null
  private socket: net.Socket | null = null
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

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = this.config.port ?? 9100
      const host = this.config.host ?? '0.0.0.0'
      this.server = net.createServer((socket) => {
        this.socket = socket
        const peer = `${socket.remoteAddress}:${socket.remotePort}`
        logger.info('tcp-server', `Analyzer connected from ${peer} (${this.instrumentId})`)
        this.emitStatus('online', peer)

        socket.on('data', (chunk) => this.emit('data', chunk))
        socket.on('error', (err) => {
          logger.warn('tcp-server', `Socket error: ${err.message}`)
          this.emit('error', err)
        })
        socket.on('close', () => {
          logger.info('tcp-server', `Analyzer disconnected (${this.instrumentId})`)
          this.socket = null
          if (this.running) this.emitStatus('listening')
        })
      })

      this.server.on('error', (err) => {
        logger.error('tcp-server', `Listen error on ${host}:${port}: ${err.message}`)
        this.emitStatus('error')
        reject(err)
      })

      this.server.listen(port, host, () => {
        this.running = true
        logger.info('tcp-server', `Listening on ${host}:${port} for ${this.instrumentId}`)
        this.emitStatus('listening')
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.running = false
      this.socket?.destroy()
      this.socket = null
      if (this.server) {
        this.server.close(() => {
          this.emitStatus('offline')
          resolve()
        })
        this.server = null
      } else {
        this.emitStatus('offline')
        resolve()
      }
    })
  }

  write(data: Buffer | string): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(data)
    }
  }

  private emitStatus(status: ConnectionStatus, peer?: string): void {
    this.emit('status', status, peer)
  }
}
