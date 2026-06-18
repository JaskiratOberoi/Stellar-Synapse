import type { ITransport } from './ITransport'
import type { InstrumentConnectionConfig } from '../../../shared/types'
import { TcpClient } from './TcpClient'
import { logger } from '../logger'

/**
 * Keeps a live instrument session active: periodic poll writes plus optional
 * idle reconnect so analyzers that only flush on connect still deliver data.
 */
export class InstrumentPollScheduler {
  private pollTimer: NodeJS.Timeout | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private cmdIndex = 0
  private lastInboundAt = Date.now()

  constructor(
    private readonly instrumentName: string,
    private readonly transport: ITransport,
    private readonly config: InstrumentConnectionConfig
  ) {}

  start(): void {
    this.touchInbound()
    const interval = this.config.pollIntervalMs
    if (interval && interval > 0 && this.config.pollCommands?.length) {
      this.pollTimer = setInterval(() => this.poll(), interval)
      // Nudge once right away so a just-finished test is picked up quickly.
      setTimeout(() => this.poll(), 500)
    }
    const idle = this.config.idleReconnectMs
    if (idle && idle > 0) {
      this.idleTimer = setInterval(() => this.checkIdle(), Math.min(idle, 15000))
    }
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.pollTimer = null
    this.idleTimer = null
  }

  touchInbound(): void {
    this.lastInboundAt = Date.now()
  }

  private poll(): void {
    if (!this.transport.isRunning()) return
    const cmds = this.config.pollCommands
    if (!cmds?.length) return
    const cmd = cmds[this.cmdIndex++ % cmds.length]!
    this.transport.write(cmd)
    logger.info('poll', `${this.instrumentName}: poll -> ${JSON.stringify(cmd)}`)
  }

  private checkIdle(): void {
    const idle = this.config.idleReconnectMs ?? 0
    if (!idle || Date.now() - this.lastInboundAt < idle) return
    if (!(this.transport instanceof TcpClient)) return
    logger.info('poll', `${this.instrumentName}: no data for ${idle}ms — reconnecting`)
    this.lastInboundAt = Date.now()
    this.transport.forceReconnect()
    setTimeout(() => this.poll(), 800)
  }
}

/** Default poll cadence for Landwind LD-560 (Server TCP, Simple protocol). */
export const LD560_POLL = {
  /** Gentle ENQ poll — full TRANSMIT spam triggered bitmap dumps; ENQ may pull text results. */
  pollIntervalMs: 15000,
  pollCommands: ['\x05'] as string[],
  /** Refresh the session periodically in case the analyzer flushes on connect. */
  idleReconnectMs: 60000
}
