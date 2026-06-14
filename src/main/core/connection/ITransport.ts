import type { EventEmitter } from 'node:events'
import type { InstrumentConnectionConfig } from '../../../shared/types'

/**
 * A transport is the physical/network channel to an analyzer. It is
 * intentionally protocol-agnostic: it emits raw `data` (Buffer) chunks and
 * accepts raw `write` calls. Protocol decoding happens one layer up.
 *
 * Events:
 *  - 'data'   (chunk: Buffer)            raw bytes received
 *  - 'status' (status, peer?)            connection lifecycle changes
 *  - 'error'  (err: Error)
 */
export interface ITransport extends EventEmitter {
  readonly kind: string
  start(): Promise<void>
  stop(): Promise<void>
  /** Write raw bytes back to the analyzer (e.g. ACK, host-query response). */
  write(data: Buffer | string): void
  isRunning(): boolean
}

export interface TransportFactoryArgs {
  instrumentId: string
  config: InstrumentConnectionConfig
}
