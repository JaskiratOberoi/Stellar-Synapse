import type { CanonicalResult, InstrumentDriverInfo } from '../../../shared/types'
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
  /** Analytes this instrument can report. */
  analytes(): DriverAnalyte[]
  /** Normalize a decoded protocol message into canonical results. */
  parse(message: ProtocolMessage, instrumentId: string): CanonicalResult[]
  /**
   * Produce a realistic raw protocol frame for a sample (used by the simulator).
   * Returns text in the driver's native protocol (ASTM rows or HL7 segments).
   */
  buildSample(sampleId: string, analytes: DriverAnalyte[]): string
}
