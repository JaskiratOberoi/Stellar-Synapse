import type { AuOnlineTestNo, CanonicalResult, InstrumentDriverInfo } from '../../../shared/types'
import type { ProtocolMessage } from '../protocols/IProtocol'

/** A known analyte a driver can report (seeds the mapping catalog + simulator). */
export interface DriverAnalyte {
  code: string
  name: string
  unit?: string
  /** Plausible value range used by the simulator. */
  sim?: { min: number; max: number; decimals?: number; ref?: string }
}

/**
 * Per-instrument context passed to parse(): configuration that varies between two
 * instruments sharing the same driver (e.g. a per-site Beckman AU Online Test No.
 * table from a location preset). Optional — most drivers ignore it.
 */
export interface DriverParseContext {
  auOnline?: { testNos: AuOnlineTestNo[] }
}

/**
 * An instrument driver knows how to normalize one analyzer model's protocol
 * messages into protocol-agnostic `CanonicalResult`s, and advertises the
 * analytes it produces so the UI can pre-populate the mapping screen.
 *
 * Adding support for a new analyzer = implement this interface and register it.
 */
export interface IInstrumentDriver {
  readonly info: InstrumentDriverInfo
  /** When true, LIS writes for this driver send only the value (no abnormal flag). */
  readonly lisValueOnly?: boolean
  /** When true, the analyzer uses bare ASTM framing (no <EOT>); flush on the L terminator. */
  readonly astmFlushOnTerminator?: boolean
  /**
   * ASTM record-layout dialect for non-standard analyzers. 'mindray' selects the
   * BS-series layout (barcode in the O Specimen ID field 4, analyte code/value in
   * component 1) and its "SA" order-download format. Undefined = standard ASTM.
   */
  readonly astmDialect?: 'mindray'
  /** When true, the analyzer reconnects per result batch; keep the UI status 'online' between batches. */
  readonly transientConnection?: boolean
  /** Analytes this instrument can report. */
  analytes(): DriverAnalyte[]
  /** Normalize a decoded protocol message into canonical results. */
  parse(message: ProtocolMessage, instrumentId: string, ctx?: DriverParseContext): CanonicalResult[]
  /**
   * Produce a realistic raw protocol frame for a sample (used by the simulator).
   * Returns text in the driver's native protocol (ASTM rows or HL7 segments).
   */
  buildSample(sampleId: string, analytes: DriverAnalyte[]): string
}
