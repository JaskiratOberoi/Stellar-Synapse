import type { ProtocolKind } from '../../../shared/types'

/** A protocol message broken into records/segments and the raw frame. */
export interface ProtocolMessage {
  protocol: ProtocolKind
  /** Logical records (ASTM rows) or segments (HL7 lines). */
  records: string[][]
  /** The raw textual frame (control chars stripped/escaped) for the raw view. */
  raw: string
}

/**
 * A protocol decoder turns a stream of raw bytes into discrete
 * `ProtocolMessage`s. Decoders are stateful (they buffer partial frames) and
 * emit one message per complete transmission.
 */
export interface IProtocol {
  readonly kind: ProtocolKind
  /**
   * Feed raw bytes; returns zero or more fully-decoded messages.
   * The decoder retains any incomplete remainder for the next call.
   */
  feed(chunk: Buffer): ProtocolMessage[]
  /** Reset buffered state (e.g. on disconnect). */
  reset(): void
}
