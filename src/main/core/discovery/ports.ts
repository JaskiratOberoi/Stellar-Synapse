/**
 * Curated TCP ports probed during discovery. These are common ports used by
 * lab analyzers / LIS interfaces plus a few infrastructure ports that help
 * classify a host (SQL Server for the LIS DB, web UIs for device management).
 *
 * The scan is read-only: it performs a TCP connect (SYN) and immediately
 * closes; no application data is ever sent.
 */
export interface CandidatePort {
  port: number
  service: string
  /** Hints a likely analyzer interface (raises the "instrument" score). */
  instrument?: boolean
}

export const CANDIDATE_PORTS: CandidatePort[] = [
  { port: 9100, service: 'Instrument (ASTM/HL7)', instrument: true },
  { port: 9101, service: 'Instrument (ASTM/HL7)', instrument: true },
  { port: 9102, service: 'Instrument (ASTM/HL7)', instrument: true },
  { port: 9103, service: 'Instrument (ASTM/HL7)', instrument: true },
  { port: 12000, service: 'Instrument (ASTM)', instrument: true },
  { port: 5000, service: 'Instrument / service', instrument: true },
  { port: 5001, service: 'Instrument / service', instrument: true },
  { port: 6000, service: 'Instrument (HL7)', instrument: true },
  { port: 6001, service: 'Instrument (HL7)', instrument: true },
  { port: 7000, service: 'Instrument (HL7/MLLP)', instrument: true },
  { port: 2575, service: 'HL7 (MLLP, IANA)', instrument: true },
  { port: 3000, service: 'Instrument / service', instrument: true },
  { port: 1433, service: 'SQL Server (LIS DB)' },
  { port: 502, service: 'Modbus (device)' },
  { port: 80, service: 'Web UI' },
  { port: 443, service: 'Web UI (TLS)' },
  { port: 8080, service: 'Web UI' },
  { port: 23, service: 'Telnet (legacy device)' },
  { port: 22, service: 'SSH' },
  { port: 445, service: 'Windows host (SMB)' }
]
