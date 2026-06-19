/**
 * Stellar Synapse - shared domain models
 *
 * These types are shared between the Electron main process (backend),
 * the preload bridge, and the React renderer (UI). They model the data
 * flow:  Analyzer -> Transport -> Protocol -> Driver -> CanonicalResult
 *        -> Mapping -> LIS Repository -> Noble LIS database.
 */

// ---------------------------------------------------------------------------
// Transport / protocol enums
// ---------------------------------------------------------------------------

/** How the middleware physically talks to an analyzer. */
export type TransportKind = 'tcp-server' | 'tcp-client' | 'serial'

/** Wire protocol an analyzer speaks. */
export type ProtocolKind = 'astm' | 'hl7' | 'poct1a' | 'custom' | 'simple' | 'beckman-au'

/** Direction of an instrument interface. */
export type InterfaceMode = 'unidirectional' | 'bidirectional'

// ---------------------------------------------------------------------------
// Driver catalog (what instruments Stellar Synapse knows how to talk to)
// ---------------------------------------------------------------------------

/**
 * A driver describes a supported analyzer model. The renderer reads the driver
 * catalog to populate the "Add Instrument" wizard, so adding a driver in the
 * backend automatically surfaces it in the UI.
 */
export interface InstrumentDriverInfo {
  /** Stable id, e.g. "maglumi-x3". */
  id: string
  /** Human label, e.g. "SNIBE Maglumi X3". */
  name: string
  vendor: string
  /** Category, e.g. "Immunoassay", "Hematology", "Chemistry". */
  category: string
  protocol: ProtocolKind
  /** Transports this driver supports. First entry is the recommended default. */
  transports: TransportKind[]
  mode: InterfaceMode
  /** Default listening/connecting port for TCP transports. */
  defaultPort?: number
  /** Short description shown in the catalog card. */
  description: string
  /** Whether the protocol decoding is fully implemented (vs. skeleton). */
  maturity: 'stable' | 'beta' | 'skeleton'
}

// ---------------------------------------------------------------------------
// Configured instruments (a driver + connection settings + runtime state)
// ---------------------------------------------------------------------------

export type ConnectionStatus = 'online' | 'offline' | 'listening' | 'error' | 'connecting'

export interface InstrumentConnectionConfig {
  transport: TransportKind
  /** TCP host. For tcp-server this is the bind address (default 0.0.0.0). */
  host?: string
  /** TCP port. */
  port?: number
  /** Serial port path, e.g. "COM3". */
  serialPath?: string
  baudRate?: number
  /** Enable host-query (analyzer asks the LIS what tests to run by barcode). */
  hostQuery?: boolean
  /**
   * Passive read-only tap: connect to the analyzer and only listen. The
   * transport never writes bytes back (no ACK/ENQ/host-query) and the pipeline
   * never writes to the LIS DB. Used to non-intrusively import data from live
   * instruments that may already be talking to another host.
   */
  passive?: boolean
  /**
   * Auto-identify lifecycle: when the tap receives real data, fingerprint the
   * analyzer (vendor/model) and adopt the matching driver, then prune sibling
   * taps on the same host that received nothing. Used by network discovery to
   * converge several candidate ports onto the one real instrument.
   */
  autoIdentify?: boolean
  /**
   * When set, periodically write poll commands to request pending results
   * (used when the analyzer listens as TCP server and does not push on its own).
   */
  pollIntervalMs?: number
  pollCommands?: string[]
  /** Reconnect the transport if no inbound bytes arrive within this window. */
  idleReconnectMs?: number
}

export interface InstrumentDefinition {
  id: string
  /** User-facing name, e.g. "Maglumi X3 - Bench 2". */
  name: string
  driverId: string
  protocol: ProtocolKind
  connection: InstrumentConnectionConfig
  enabled: boolean
  createdAt: string
}

/** A configured instrument plus its live runtime state (sent to the UI). */
export interface InstrumentRuntime extends InstrumentDefinition {
  status: ConnectionStatus
  lastMessageAt?: string
  messagesReceived: number
  resultsProcessed: number
  errors: number
  /** Remote peer description when connected (ip:port). */
  peer?: string
}

// ---------------------------------------------------------------------------
// Canonical result (protocol-agnostic, the unit of work through the pipeline)
// ---------------------------------------------------------------------------

export type ResultFlag = 'N' | 'H' | 'L' | 'HH' | 'LL' | 'A'

/**
 * A single analyte result, normalized by an instrument driver from the raw
 * protocol message into a protocol-agnostic shape.
 */
export interface CanonicalResult {
  id: string
  instrumentId: string
  /** Sample / accession barcode. Maps to LIS `vailid`. */
  sampleId: string
  /**
   * Secondary barcode candidate, when the analyzer can place the scanned sample
   * barcode in more than one field (e.g. an EDAN H60 configured to scan into the
   * patient-id field instead of the sample-id field). The Orchestrator verifies
   * `sampleId` against the LIS and falls back to this when only the alternate is
   * a registered order.
   */
  altSampleId?: string
  /** Instrument analyte code, e.g. "TSH", "FT4". */
  analyteCode: string
  analyteName?: string
  value: string
  unit?: string
  referenceRange?: string
  flag?: ResultFlag
  /** Instrument-reported completion time (ISO). */
  measuredAt?: string
  /** When the middleware received it (ISO). */
  receivedAt: string
}

// ---------------------------------------------------------------------------
// LIS catalog + orders (mirrors the Noble schema we mapped)
// ---------------------------------------------------------------------------

/** Mirrors dbo.tbl_med_test_master. */
export interface LisTest {
  id: number
  testCode: string
  testName: string
  department?: string
  hasParameters: boolean
}

/** Mirrors dbo.tbl_med_parameter_master. */
export interface LisParameter {
  id: number
  /** Parent test id (tbl_med_parameter_master.TestCode -> tbl_med_test_master.id). */
  testId: number
  code: string
  name: string
  method?: string
  unit?: string
}

/** A pending order looked up by barcode. Mirrors tbl_med_mcc_patient_samples. */
export interface TestOrder {
  vailid: string
  patientId?: number
  testCodes: string[]
  testNames: string[]
  sampleStatus?: number
}

/**
 * Outcome of a single LIS write:
 *  - 'written' — an existing (pre-created at registration) result row was filled.
 *  - 'skipped' — no matching ordered row for this test/SID; nothing was written
 *    (Synapse never inserts an orphan row the LIS status logic would ignore).
 */
export type LisWriteOutcome = 'written' | 'skipped'

/**
 * Payload written to dbo.tbl_med_mcc_patient_test_result.
 * Captured here as a record of what *would* be persisted (mock phase).
 */
export interface LisResultWrite {
  vailid: string
  testId: number
  paramId?: number
  testCode: string
  testName: string
  value: string
  unit?: string
  abnormal: boolean
  machineName: string
  uploadFlag: string
  addedDate: string
}

// ---------------------------------------------------------------------------
// Mapping (instrument analyte code -> LIS test/parameter, with override)
// ---------------------------------------------------------------------------

export type MappingStatus = 'auto' | 'manual' | 'unmapped' | 'ignored'

export interface MappingRule {
  id: string
  /** Which instrument/driver this rule belongs to. */
  driverId: string
  /** Instrument analyte code, e.g. "FT4". */
  instrumentCode: string
  instrumentName?: string
  /** Resolved LIS test. */
  lisTestId?: number
  lisTestCode?: string
  lisTestName?: string
  /** Resolved LIS parameter (optional, for paneled tests). */
  lisParamId?: number
  lisParamName?: string
  /** Unit conversion target (optional). */
  unit?: string
  status: MappingStatus
  /** Confidence 0-1 for auto-suggested matches. */
  confidence?: number
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Live monitor + logging
// ---------------------------------------------------------------------------

export type MonitorStage =
  | 'received'
  | 'decoded'
  | 'mapped'
  | 'written'
  | 'skipped'
  | 'error'
  | 'queued'

export interface MonitorEvent {
  id: string
  instrumentId: string
  instrumentName: string
  sampleId: string
  analyteCode: string
  analyteName?: string
  value: string
  unit?: string
  flag?: ResultFlag
  stage: MonitorStage
  /** Resolved mapping target description, e.g. "TSH (Thyroid Profile)". */
  mappedTo?: string
  message?: string
  /** Raw protocol frame (truncated) for the raw view. */
  raw?: string
  timestamp: string
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  level: LogLevel
  source: string
  message: string
  timestamp: string
}

// ---------------------------------------------------------------------------
// LIS connection settings (SQL Server / Noble)
// ---------------------------------------------------------------------------

export interface LisConnectionSettings {
  server: string
  database: string
  user: string
  password: string
  port: number
  /** When false, the SQL repository is bypassed and the mock is used. */
  live: boolean
  encrypt: boolean
}

export type LisConnectionState = 'disconnected' | 'connected' | 'mock' | 'error'

export interface LisConnectionResult {
  state: LisConnectionState
  message: string
  testedAt: string
}

// ---------------------------------------------------------------------------
// Dashboard aggregate
// ---------------------------------------------------------------------------

export interface DashboardStats {
  instrumentsOnline: number
  instrumentsTotal: number
  resultsToday: number
  resultsPerHour: { hour: string; count: number }[]
  errorsToday: number
  mappedAnalytes: number
  unmappedAnalytes: number
  lisState: LisConnectionState
}

// ---------------------------------------------------------------------------
// Network discovery (read-only LAN scan for instruments)
// ---------------------------------------------------------------------------

export interface DiscoverySubnet {
  /** CIDR, e.g. "192.168.1.0/24". */
  cidr: string
  /** This host's address on the subnet. */
  address: string
  netmask: string
  interfaceName: string
  /** Heuristic: virtual adapter (WSL/Hyper-V/VMware/etc.) vs physical LAN. */
  isVirtual: boolean
}

export interface DiscoveredPort {
  port: number
  /** Friendly label, e.g. "Instrument (ASTM/HL7)", "SQL Server", "Web UI". */
  service: string
}

export interface DiscoveredHost {
  ip: string
  mac?: string
  /** Vendor inferred from the MAC OUI (best-effort). */
  vendor?: string
  /** Host responded (open or actively refused a probe). */
  reachable: boolean
  openPorts: DiscoveredPort[]
  /** Suggested driver id if ports/vendor look like a known analyzer. */
  guessedDriverId?: string
  guessedInstrument?: string
  /** This machine. */
  isSelf?: boolean
  lastSeen: string
}

export interface ScanProgress {
  cidr: string
  scanned: number
  total: number
  percent: number
  done: boolean
}

// ---------------------------------------------------------------------------
// App settings
// ---------------------------------------------------------------------------

export interface AppSettings {
  theme: 'dark' | 'light'
  simulatorEnabled: boolean
  /** Messages-per-minute the simulator emits per online instrument. */
  simulatorRate: number
  autoMapOnReceive: boolean
  /** When live LIS is enabled, auto-write HbA1c panel results on receive. */
  lisAutoWrite: boolean
}
