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
  /**
   * HbA1c HPLC analyzers that can derive Estimated Average Glucose (eAG) from
   * the measured HbA1c. Surfaces the "Auto-calculate eAG" toggle in the UI and
   * gates the derivation in the pipeline (Agappe Mispa Maestro).
   */
  derivesEag?: boolean
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
  /** Serial data bits. Beckman AU "Online" uses 7; most ASTM serial uses 8. */
  dataBits?: 7 | 8
  /** Serial parity. AU "Online" uses 'none'. */
  parity?: 'none' | 'even' | 'odd'
  /** Serial stop bits. */
  stopBits?: 1 | 2
  /** Enable host-query (analyzer asks the LIS what tests to run by barcode). */
  hostQuery?: boolean
  /**
   * Auto-calculate Estimated Average Glucose (eAG) from HbA1c and write it to
   * the LIS alongside the HbA1c. Only meaningful for `derivesEag` drivers
   * (Agappe Mispa Maestro); enabled by default (undefined = on).
   */
  autoEag?: boolean
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

/** A serial port enumerated from the host, for the COM-port picker. */
export interface SerialPortInfo {
  /** Port path, e.g. "COM3". */
  path: string
  manufacturer?: string
  /** Windows-friendly label, e.g. "Communications Port (COM1)". */
  friendlyName?: string
  pnpId?: string
}

/**
 * One Beckman AU "Online" Test No. assignment: the 2-3 digit number the analyzer
 * transmits on the wire, and the Synapse analyte code it decodes to. Labs renumber
 * this table per analyzer, so it is captured per site (see location presets).
 */
export interface AuOnlineTestNo {
  /** Online Test No. transmitted on the wire (1-120). */
  no: number
  /** Synapse AU analyte code this number decodes to, e.g. "AST". */
  code: string
  /** Display name (used for analytes outside the driver's default AU menu). */
  name?: string
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
  /**
   * Beckman AU "Online" per-site decode table (Online Test No. -> analyte code),
   * applied from a location preset. When present it OVERRIDES the driver's default
   * AU_ONLINE_TESTS numbering for BOTH result parsing and host-query order
   * responses — the same wire number means a different analyte at each lab.
   */
  auOnline?: { testNos: AuOnlineTestNo[] }
}

/** A configured instrument plus its live runtime state (sent to the UI). */
export interface InstrumentRuntime extends InstrumentDefinition {
  status: ConnectionStatus
  lastMessageAt?: string
  messagesReceived: number
  /** Distinct samples (SIDs) processed — one sample counts once regardless of how
   *  many analyte params it carried. */
  resultsProcessed: number
  /** Individual analyte params processed across all samples (a sample with 8
   *  analytes adds 8 here but 1 to `resultsProcessed`). */
  resultParamsProcessed: number
  errors: number
  /** Remote peer description when connected (ip:port). */
  peer?: string
}

// ---------------------------------------------------------------------------
// Location presets (bundled per-lab configuration templates)
// ---------------------------------------------------------------------------

export interface PresetSerial {
  baudRate?: number
  dataBits?: 7 | 8
  parity?: 'none' | 'even' | 'odd'
  stopBits?: 1 | 2
}

/**
 * One analyte -> Noble LIS mapping carried by a preset. Applied at onboarding so
 * a site's curated mappings are reproduced on a fresh install without re-mapping.
 * `lisTestName`/`lisParamName` may be supplied via a shorthand `name` key in the
 * preset JSON (the registry fills the appropriate field from it).
 */
export interface PresetMapping {
  instrumentCode: string
  status?: 'auto' | 'manual'
  lisTestId?: number
  lisTestCode?: string
  lisTestName?: string
  lisParamId?: number
  lisParamName?: string
}

/** One analyzer's settings within a location preset. */
export interface PresetInstrument {
  driverId: string
  /** Model label for display in the preset picker. */
  model: string
  /** Recommended transport for this site (first of the driver's supported set). */
  transport?: TransportKind
  port?: number
  serial?: PresetSerial
  /** Beckman AU per-site Online Test No. decode table (AU analyzers only). */
  auOnlineTestNos?: AuOnlineTestNo[]
  /** Per-site analyte -> Noble LIS mappings, applied at onboarding. */
  mappings?: PresetMapping[]
}

/** A named, location-scoped bundle of instrument settings applied at onboarding. */
export interface LocationPreset {
  /** Slug, e.g. "haldwani". */
  preset: string
  /** Display location, e.g. "Haldwani". */
  location: string
  instruments: PresetInstrument[]
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
  /** Patient display name, when the LIS provides it (used in the AU480 S-frame). */
  patientName?: string
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
export type LisWriteOutcome = 'written' | 'skipped' | 'suppressed'

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
  /**
   * When true, the repository writes only the value (plus bookkeeping columns)
   * and never the `abnormal` flag, so the LIS keeps its own reference-range
   * determination. Set by value-only drivers (e.g. Agappe Mispa Maestro HbA1c).
   */
  valueOnly?: boolean
  machineName: string
  uploadFlag: string
  addedDate: string
}

// ---------------------------------------------------------------------------
// Mapping (instrument analyte code -> LIS test/parameter, with override)
// ---------------------------------------------------------------------------

export type MappingStatus = 'auto' | 'manual' | 'unmapped' | 'ignored'

// (MappingRule below) — analyzerCode carries the analyzer's own channel/transmit
// name when it differs from the generic instrumentCode (e.g. a SNIBE MAGLUMI X3
// "Channel No." like "Vit B12 III"). It is what Synapse sends in a host-query
// order and what it matches on result upload.
export interface MappingRule {
  id: string
  /** Which instrument/driver this rule belongs to. */
  driverId: string
  /** Instrument analyte code, e.g. "FT4". */
  instrumentCode: string
  instrumentName?: string
  /**
   * Analyzer channel / transmit name, when it differs from instrumentCode. Sent
   * in host-query order records and matched against uploaded result codes. Falls
   * back to instrumentCode when empty. (e.g. MAGLUMI X3 "Channel No.")
   */
  analyzerCode?: string
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
  | 'suppressed'
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
  /**
   * Read-only safe mode. When true *and* `live` is true, Synapse connects to the
   * real Noble SQL Server for READS (catalog, host-query order lookups) but every
   * write is blocked (no result is ever persisted). Lets the host-query feature be
   * tested against live data with zero risk to the production database.
   */
  readOnly?: boolean
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
  /**
   * Launch Stellar Synapse automatically at user login (starts hidden in the
   * system tray so interfacing resumes on boot without showing the UI).
   */
  launchAtStartup: boolean
}
