import type { InstrumentDriverInfo, InterfaceMode, ProtocolKind, TransportKind } from '../../../shared/types'
import { BECKMAN_AU } from './beckmanAu'
import { MINDRAY_BS_CHEM } from './mindray'
import type { DriverAnalyte } from './IInstrumentDriver'
import {
  BOULE_CBC,
  CBC,
  CHEMISTRY,
  COAGULATION,
  EDAN_H60,
  ELECTROLYTES,
  FIA_PANEL,
  HBA1C_HPLC,
  HBA1C_MAESTRO,
  HORIBA_ESR,
  HORIBA_YUMIZEN,
  HX58_CBC,
  IMMUNOASSAY_FULL,
  INTEGRATED,
  URINALYSIS,
  combine
} from './panels'

/** A model definition is an InstrumentDriverInfo plus the analytes it reports. */
export type ModelDefinition = InstrumentDriverInfo & {
  analytes: DriverAnalyte[]
  /**
   * HL7 parsing dialect for `protocol: 'hl7'` models (default 'generic').
   * 'getein' selects the Metis OBR-2 (barcode) / OBX-3 (item id) layout;
   * 'edan' selects the H60 OBR-2 (sample id) / OBX-4 (analyte mnemonic) layout;
   * 'boule' selects the BM500 OBR-3 (barcode) / OBX-3 component-2 (mnemonic)
   * layout (Swelab Lumi / Medonic M51).
   */
  hl7Dialect?: 'generic' | 'getein' | 'edan' | 'boule' | 'horiba'
  /**
   * ASTM record-layout / host-query dialect for `protocol: 'astm'` models
   * (default standard). 'mindray' selects the Mindray BS-series layout and "SA"
   * order-download. 'beckman-dxi' selects the Beckman Access/DxI order-download
   * (standard E1381 H/P/O/L frames, tests joined by "\" in O-5, report type Q).
   */
  astmDialect?: 'mindray' | 'beckman-dxi'
  /**
   * When true, LIS writes for this model send only the result value (never the
   * abnormal flag), leaving Noble to apply its own reference range. Used by the
   * Agappe Mispa Maestro HbA1c integration (map by SID, send the value only).
   */
  lisValueOnly?: boolean
  /**
   * Bare ASTM framing: the analyzer sends no E1381 envelope (no inter-record CR,
   * no checksum, no <EOT>) and ends the message with the L terminator, so the
   * decoder must flush on that terminator (Agappe Mispa Maestro / BH60).
   */
  astmFlushOnTerminator?: boolean
  /**
   * Analyzer opens a new connection per result batch and disconnects after, so
   * the UI status stays 'online' between batches instead of flapping back to
   * 'listening' on each inter-batch disconnect (Agappe Mispa Maestro / BH60).
   */
  transientConnection?: boolean
}

interface MkOpts {
  protocol?: ProtocolKind
  mode?: InterfaceMode
  port: number
  maturity?: InstrumentDriverInfo['maturity']
  transports?: TransportKind[]
  hl7Dialect?: ModelDefinition['hl7Dialect']
  astmDialect?: ModelDefinition['astmDialect']
  lisValueOnly?: boolean
  derivesEag?: boolean
  astmFlushOnTerminator?: boolean
  transientConnection?: boolean
}

function mk(
  id: string,
  name: string,
  vendor: string,
  category: string,
  description: string,
  analytes: DriverAnalyte[],
  opts: MkOpts
): ModelDefinition {
  return {
    id,
    name,
    vendor,
    category,
    description,
    analytes,
    protocol: opts.protocol ?? 'astm',
    mode: opts.mode ?? 'bidirectional',
    transports: opts.transports ?? ['tcp-server', 'serial'],
    defaultPort: opts.port,
    maturity: opts.maturity ?? 'skeleton',
    ...(opts.derivesEag ? { derivesEag: true } : {}),
    ...(opts.hl7Dialect ? { hl7Dialect: opts.hl7Dialect } : {}),
    ...(opts.astmDialect ? { astmDialect: opts.astmDialect } : {}),
    ...(opts.lisValueOnly ? { lisValueOnly: true } : {}),
    ...(opts.astmFlushOnTerminator ? { astmFlushOnTerminator: true } : {}),
    ...(opts.transientConnection ? { transientConnection: true } : {})
  }
}

/** Build a set of models that share everything except id/name. */
function family(
  pairs: [string, string][],
  vendor: string,
  category: string,
  description: string,
  analytes: DriverAnalyte[],
  opts: MkOpts,
  betaIds: string[] = []
): ModelDefinition[] {
  return pairs.map(([id, name]) =>
    mk(id, name, vendor, category, description, analytes, {
      ...opts,
      maturity: betaIds.includes(id) ? 'beta' : opts.maturity
    })
  )
}

// ---------------------------------------------------------------------------
// SNIBE - Maglumi (CLIA immunoassay)
// ---------------------------------------------------------------------------
const maglumi = [
  ...family(
    [
      ['maglumi-600', 'MAGLUMI 600'],
      ['maglumi-800', 'MAGLUMI 800'],
      ['maglumi-1000', 'MAGLUMI 1000'],
      ['maglumi-2000', 'MAGLUMI 2000'],
      ['maglumi-2000-plus', 'MAGLUMI 2000 Plus'],
      ['maglumi-4000', 'MAGLUMI 4000'],
      ['maglumi-4000-plus', 'MAGLUMI 4000 Plus']
    ],
    'SNIBE Diagnostics',
    'Immunoassay (CLIA)',
    'MAGLUMI M-series chemiluminescence immunoassay analyzer. ASTM E1394 over TCP/IP or serial, with host-query support.',
    IMMUNOASSAY_FULL,
    { port: 9100, protocol: 'astm' },
    ['maglumi-2000']
  ),
  // X-series (X3 kept as ASTM for parity with the original driver; others HL7).
  mk(
    'maglumi-x3',
    'MAGLUMI X3',
    'SNIBE Diagnostics',
    'Immunoassay (CLIA)',
    'MAGLUMI X-series (X-TECH) chemiluminescence immunoassay analyzer, up to 200 T/H. ASTM E1394 over TCP/IP or serial.',
    IMMUNOASSAY_FULL,
    { port: 9100, protocol: 'astm', maturity: 'beta' }
  ),
  ...family(
    [
      ['maglumi-x6', 'MAGLUMI X6'],
      ['maglumi-x8', 'MAGLUMI X8'],
      ['maglumi-x10', 'MAGLUMI X10']
    ],
    'SNIBE Diagnostics',
    'Immunoassay (CLIA)',
    'MAGLUMI X-series (X-TECH) high-throughput chemiluminescence analyzer. HL7 v2.x over MLLP or ASTM.',
    IMMUNOASSAY_FULL,
    { port: 9100, protocol: 'hl7' },
    ['maglumi-x8']
  )
]

// ---------------------------------------------------------------------------
// SNIBE - Biossays (chemistry / electrolyte), Biolumi (integrated), Hemolumi
// ---------------------------------------------------------------------------
const snibeOther = [
  ...family(
    [
      ['biossays-c8', 'Biossays C8'],
      ['biossays-c10', 'Biossays C10'],
      ['biossays-240-plus', 'Biossays 240 Plus']
    ],
    'SNIBE Diagnostics',
    'Clinical Chemistry',
    'Biossays automatic biochemistry analyzer. ASTM E1394 over TCP/IP or serial.',
    combine(CHEMISTRY, ELECTROLYTES),
    { port: 9110, protocol: 'astm' }
  ),
  mk(
    'biossays-e6-plus',
    'Biossays E6 Plus',
    'SNIBE Diagnostics',
    'Electrolyte',
    'Biossays E6 Plus electrolyte analyzer (ISE: K, Na, Cl, iCa, pH).',
    ELECTROLYTES,
    { port: 9110, protocol: 'astm' }
  ),
  mk(
    'biolumi-cx8',
    'Biolumi CX8',
    'SNIBE Diagnostics',
    'Integrated (Chemistry + CLIA)',
    'Biolumi CX8 integrated chemistry + immunoassay system. HL7 v2.x over MLLP or ASTM.',
    INTEGRATED,
    { port: 9100, protocol: 'hl7' }
  ),
  mk(
    'snibe-hemolumi',
    'Hemolumi (Coagulation)',
    'SNIBE Diagnostics',
    'Coagulation',
    'Hemolumi coagulation analyzer (PT/APTT/INR/Fibrinogen). Protocol mapping pending vendor spec.',
    COAGULATION,
    { port: 9140, protocol: 'astm' }
  )
]

// ---------------------------------------------------------------------------
// Getein - MAGICL (CLIA) and Getein/FIA (immunofluorescence POCT)
// ---------------------------------------------------------------------------
const getein = [
  ...family(
    [
      ['magicl-6000', 'Getein MAGICL 6000'],
      ['magicl-6000i', 'Getein MAGICL 6000i'],
      ['magicl-6100', 'Getein MAGICL 6100'],
      ['magicl-6200', 'Getein MAGICL 6200'],
      ['magicl-6200i', 'Getein MAGICL 6200i'],
      ['magicl-6800', 'Getein MAGICL 6800'],
      ['magicl-8500', 'Getein MAGICL 8500']
    ],
    'Getein Biotech',
    'Immunoassay (CLIA)',
    'Getein MAGICL-series acridinium-ester chemiluminescence immunoassay analyzer (up to ~200 T/H; ' +
      'thyroid, fertility, tumor, cardiac, infectious-disease, bone, anemia, diabetes and autoimmune ' +
      'markers). Interfaces over HL7 v2.3.1 (ORU^R01 result upload; MSH/PID/OBR/OBX), verified against ' +
      'a live MAGICL 6000i at Karnal. On the analyzer set the LIS interface to HL7 + Ethernet, with ' +
      "Server IP = this host's instrument-LAN IP and COM Port 8081; the analyzer dials out to that " +
      'host, so Synapse listens as a TCP server on port 8081 (accepts the incoming connection). The ' +
      'accession barcode rides in OBR-2 (Placer); each analyte is keyed by the ' +
      'numeric assay item-id in OBX-3 with the friendly name in OBX-4 (e.g. "OBX|1|NM|25|IgE|659.45|' +
      'IU/mL") — the same layout as the Getein Metis dialect, so results decode via hl7Dialect getein. ' +
      'Censored values (<7.00, >2000.00) upload verbatim. Bidirectional host-query is supported: the ' +
      'analyzer issues an HL7 QRY^Q02 (barcode in QRD-8) and Synapse answers with QCK^Q02 + DSR^Q03 ' +
      "(the sample's ordered assay item-ids), then ACKs each ORU^R01 — enable Host Query on the " +
      "instrument. The older ASTM E1394 LIS mode is also selectable on the device but this driver " +
      "targets the site's HL7 setup.",
    IMMUNOASSAY_FULL,
    {
      port: 8081,
      protocol: 'hl7',
      hl7Dialect: 'getein',
      mode: 'bidirectional',
      transports: ['tcp-server', 'tcp-client', 'serial']
    },
    // Verified against a live MAGICL 6000i (Karnal, HL7). Others share the platform.
    ['magicl-6000i', 'magicl-6200', 'magicl-6200i']
  ),
  ...family(
    [
      ['getein-1100', 'Getein 1100'],
      ['getein-1160', 'Getein 1160'],
      ['getein-1180', 'Getein 1180'],
      ['getein-1200', 'Getein 1200'],
      ['getein-1600', 'Getein 1600'],
      ['getein-fia-8000', 'Getein FIA 8000'],
      ['getein-fia-8600', 'Getein FIA 8600']
    ],
    'Getein Biotech',
    'Immunofluorescence (POCT)',
    'Getein immunofluorescence quantitative analyzer (cardiac, inflammation, diabetes markers). ASTM/serial.',
    FIA_PANEL,
    { port: 9150, protocol: 'astm', mode: 'unidirectional' }
  )
]

// ---------------------------------------------------------------------------
// Getein - Metis (HL7 v2.3.1 biochemistry, MLLP)
// ---------------------------------------------------------------------------
const geteinMetis = [
  mk(
    'getein-metis-6000',
    'Getein Metis 6000',
    'Getein Biotech',
    'Clinical Chemistry',
    'Metis-series automatic biochemistry analyzer. HL7 v2.3.1 over MLLP (TCP/IP). The ' +
      'analyzer connects as a TCP client to this server and uploads results as ORU^R01 ' +
      '(MSH-16: 0=patient, 1=calibration, 2=QC — only patient results are posted). The ' +
      'accession barcode is OBR-2 (Placer Order Number) and each analyte is keyed by ' +
      'OBX-3 (item id) with the name in OBX-4 — configure the SAME item ids on the analyzer ' +
      'and the LIS so results match. Bidirectional host-query (QRY^Q02/DSR^Q03) is supported ' +
      'by the device but order-download is pending a captured DSR sample.',
    combine(CHEMISTRY, ELECTROLYTES),
    { port: 9105, protocol: 'hl7', hl7Dialect: 'getein', transports: ['tcp-server'], maturity: 'beta' }
  )
]

// ---------------------------------------------------------------------------
// EDAN - H60 / H60 Vet hematology (HL7 over MLLP, analyzer = TCP client)
// ---------------------------------------------------------------------------
const edan = [
  ...family(
    [
      ['edan-h60', 'EDAN H60'],
      ['edan-h60-vet', 'EDAN H60 Vet']
    ],
    'EDAN Instruments',
    'Hematology (CBC)',
    'H60 / H60 Vet auto hematology analyzer (CBC/5-Diff). HL7 v2.4 over MLLP. On the ' +
      'analyzer, set the remote LIS transfer mode to MLLP, enter this server\'s IP + port, ' +
      'tick "Auto-communication", click Communication to test, then Save (firmware H60/H60s ' +
      'APP V1.10+, H60 Vet V1.05+; instrument and LIS must share a subnet). The analyzer ' +
      'connects as a TCP client to this server and uploads results. Field map verified against ' +
      'a captured H60 frame: sample id in OBR-2, analyte mnemonic in OBX-4 (OBX-3 is a constant ' +
      '"0"), escaped units (10\\S\\9/L = 10^9/L), flag in OBX-13; "---"/"***" cells are skipped.',
    EDAN_H60,
    { port: 7999, protocol: 'hl7', hl7Dialect: 'edan', mode: 'unidirectional', transports: ['tcp-server'], maturity: 'beta' }
  )
]

// ---------------------------------------------------------------------------
// Boule Diagnostics - Swelab Lumi / Medonic M51 hematology (HL7 v2.3.1 over
// MLLP, analyzer = TCP client)
// ---------------------------------------------------------------------------
const boule = [
  ...family(
    [
      ['swelab-lumi', 'Swelab Lumi'],
      ['medonic-m51', 'Medonic M51']
    ],
    'Boule Diagnostics',
    'Hematology (CBC)',
    'Swelab Lumi / Medonic M51 auto hematology analyzer (CBC / 5-part DIFF). HL7 ' +
      'v2.3.1 over MLLP (the BM500 LIS protocol). The analyzer connects out to this ' +
      'server as a TCP client and uploads results as ORU^R01 (sending application ' +
      'BM500, facility Boule) — set the analyzer\'s LIS/host IP + port to this server ' +
      'and enable automatic communication. The accession barcode rides in OBR-3 ' +
      '(Filler Order Number) and each analyte is keyed by the OBX-3 component-2 ' +
      'mnemonic (e.g. `6690-2^WBC^LN` -> WBC), with the leading "*" research marker ' +
      'stripped; MSH-11=Q (QC) frames and histogram/scattergram bitmap rows are ' +
      'ignored. Bidirectional host-query (ORM^O01/ORR^O02 order download) is ' +
      'supported by the device but pending a captured sample.',
    BOULE_CBC,
    { port: 9106, protocol: 'hl7', hl7Dialect: 'boule', mode: 'unidirectional', transports: ['tcp-server'], maturity: 'beta' }
  )
]

// ---------------------------------------------------------------------------
// Beckman Coulter - DxH (hematology), AU/DxC (chemistry), Access/DxI (immuno),
// integrated and urinalysis
// ---------------------------------------------------------------------------
const beckman = [
  // Hematology - DxH 500 keeps id 'beckman-coulter' for backward compatibility.
  mk(
    'beckman-coulter',
    'Beckman Coulter DxH 500',
    'Beckman Coulter',
    'Hematology (CBC)',
    'DxH 500 cellular analysis system (CBC/Diff). CLSI LIS01-A2 + LIS02-A2 (ASTM). Analyzer connects as TCP client to this server.',
    CBC,
    { port: 9102, protocol: 'astm', maturity: 'beta' }
  ),
  ...family(
    [
      ['beckman-dxh-520', 'Beckman Coulter DxH 520'],
      ['beckman-dxh-560', 'Beckman Coulter DxH 560'],
      ['beckman-dxh-690t', 'Beckman Coulter DxH 690T'],
      ['beckman-dxh-900', 'Beckman Coulter DxH 900']
    ],
    'Beckman Coulter',
    'Hematology (CBC)',
    'DxH-series hematology analyzer (CBC/Diff). CLSI LIS01-A2 + LIS02-A2 (ASTM).',
    CBC,
    { port: 9102, protocol: 'astm' },
    ['beckman-dxh-900']
  ),
  // AU480 — dedicated entry on the Beckman "Online" fixed-field host protocol
  // (not pipe-delimited ASTM). Carries the full configured chemistry/ISE menu.
  mk(
    'beckman-au480',
    'Beckman Coulter AU480',
    'Beckman Coulter',
    'Clinical Chemistry',
    'AU480 clinical chemistry analyzer. Beckman "Online" fixed-field host protocol ' +
      '(STX/ETX framed + 1-byte XOR BCC, 2-digit Online Test No., space-padded fixed-width ' +
      'results) over TCP/IP or RS232 serial — NOT pipe-delimited ASTM. Bidirectional: the ' +
      'analyzer sends a sample-information request (R) by barcode, Synapse answers with the ' +
      'ordered Online Test Nos (S response), then the analyzer returns results (D). Tests are ' +
      'keyed by the Online Test No. table (01=GLU … 99=Cl); the accession barcode (Sample ID) ' +
      'rides directly in the R/D records. On the analyzer set the Online format to match.',
    BECKMAN_AU,
    {
      port: 9111,
      protocol: 'beckman-au',
      mode: 'bidirectional',
      // Host link is RS-232 serial; reach it over LAN via a serial-to-Ethernet
      // device server (Synapse = tcp-client) or use native Online LAN (tcp-server).
      transports: ['serial', 'tcp-client', 'tcp-server'],
      maturity: 'beta'
    }
  ),
  ...family(
    [
      ['beckman-au680', 'Beckman Coulter AU680'],
      ['beckman-au5800', 'Beckman Coulter AU5800'],
      ['beckman-dxc-500-au', 'Beckman Coulter DxC 500 AU'],
      ['beckman-dxc-700-au', 'Beckman Coulter DxC 700 AU']
    ],
    'Beckman Coulter',
    'Clinical Chemistry',
    'AU / DxC AU clinical chemistry analyzer. Beckman "Online" fixed-field host protocol ' +
      '(2-digit Online Test No., fixed-width results) over TCP/IP or serial. Shares the AU480 ' +
      'test menu; confirm each analyzer\'s Online Test No. assignments.',
    BECKMAN_AU,
    { port: 9111, protocol: 'beckman-au' }
  ),
  ...family(
    [
      ['beckman-access-2', 'Beckman Coulter Access 2'],
      ['beckman-dxi-600', 'Beckman Coulter DxI 600'],
      ['beckman-dxi-800', 'Beckman Coulter DxI 800'],
      ['beckman-dxi-9000', 'Beckman Coulter DxI 9000']
    ],
    'Beckman Coulter',
    'Immunoassay',
    'Access / DxI immunoassay analyzer. Bidirectional ASTM E1394 (LIS01/02-A2) over TCP/IP or ' +
      'serial — verified against a live DxI at Karnal. The analyzer uploads H/P/O/R/L: the ' +
      'accession barcode rides in the O-record Specimen ID (field 3) and each analyte is keyed by ' +
      'the ASTM Universal Test ID in R field 3 ("^^^TotT4" -> TotT4); auto-dilution reruns append a ' +
      '"d" to the code (TSH3/TSH3d). Host-query is supported: the analyzer sends a Q record and ' +
      'Synapse answers with standard E1381 H/P/O/L frames listing the ordered assay codes (joined by ' +
      '"\\", report type Q). Set the analyzer LIS to this host + port and enable Host Query.',
    IMMUNOASSAY_FULL,
    { port: 9103, protocol: 'astm', astmDialect: 'beckman-dxi' },
    ['beckman-dxi-800', 'beckman-dxi-9000']
  ),
  mk(
    'beckman-dxc-500i',
    'Beckman Coulter DxC 500i',
    'Beckman Coulter',
    'Integrated (Chemistry + Immunoassay)',
    'DxC 500i integrated clinical chemistry + immunoassay analyzer. ASTM/HL7.',
    INTEGRATED,
    { port: 9111, protocol: 'astm' }
  ),
  ...family(
    [
      ['beckman-iricell', 'Beckman Coulter iRICELL'],
      ['beckman-dxu-iris', 'Beckman Coulter DxU Iris']
    ],
    'Beckman Coulter',
    'Urinalysis',
    'Urine chemistry + microscopy analyzer. ASTM/serial.',
    URINALYSIS,
    { port: 9130, protocol: 'astm' }
  )
]

// ---------------------------------------------------------------------------
// Landwind / Labnovation - LD-560 HPLC HbA1c (Simple protocol, Server TCP)
// ---------------------------------------------------------------------------
const landwind = [
  mk(
    'landwind-ld-560',
    'Zeus D-20 HPLC',
    'Landwind Medical',
    'HbA1c (HPLC)',
    'LD-560 fully automated HPLC HbA1c analyzer. Proprietary "Simple protocol" over TCP. ' +
      'Configure the analyzer as "Server TCP"; Synapse connects as tcp-client to the analyzer IP on port 8081. ' +
      'Press Transmit on the analyzer Data screen to push a result over the open connection. ' +
      'Line-based comma-delimited format: D header + per-analyte rows + END terminator.',
    HBA1C_HPLC,
    {
      port: 8081,
      protocol: 'simple',
      mode: 'unidirectional',
      transports: ['tcp-client'],
      maturity: 'beta',
      derivesEag: true
    }
  )
]

// ---------------------------------------------------------------------------
// Agappe - Mispa Maestro HPLC HbA1c + Mispa HX 58 hematology (HL7 v2.4)
// ---------------------------------------------------------------------------
const agappe = [
  mk(
    'agappe-mispa-hx58',
    'Agappe Mispa HX 58',
    'Agappe Diagnostics',
    'Hematology (CBC)',
    'Mispa HX 58 automatic 5-part-differential hematology analyzer (Dymind OEM; CBC / ' +
      'CBC+DIFF, 26 report parameters plus WBC/RBC/PLT histograms and a 4-DIFF scattergram). ' +
      'HL7 v2.4 ORU^R01 over MLLP/TCP-IP — verified against a live capture: the analyzer\'s ' +
      'default LIS output is HL7 (the "Strictly comply with HL7 protocol" toggle only affects ' +
      'strict header formatting, not the format itself). On the analyzer set System > Settings ' +
      '> LIS Setting to TCP/IP, enter this host as Server IP + Server Port (the deployed unit ' +
      'uses port 2003) and tick Enable LIS, so it connects out and uploads ORU^R01 (Synapse ' +
      'listens as a TCP server on the matching port). Shares the BM500-style HL7 layout ' +
      '(hl7Dialect "boule"): the accession barcode rides in OBR-3 (= OBR-2), and each analyte ' +
      'is keyed by the OBX-3 component-2 mnemonic (e.g. "777-3^PLT^LN" -> PLT, also echoed in ' +
      'OBX-4); value in OBX-5, live unit in OBX-6 (conventional: counts 10^3/uL, HGB/MCHC ' +
      'g/dL), flag in OBX-8. The 26-analyte menu is confirmed against a live "Transmission ' +
      'Item" config. Two-way LIS (host-query) may be enabled on the device — harmless, but ' +
      'Synapse handles result upload only; the query response is pending a captured Q frame.',
    HX58_CBC,
    { port: 2003, protocol: 'hl7', hl7Dialect: 'boule', mode: 'unidirectional', transports: ['tcp-server'], maturity: 'beta' }
  ),
  mk(
    'agappe-mispa-maestro',
    'Agappe Mispa Maestro',
    'Agappe Diagnostics',
    'HbA1c (HPLC)',
    'Mispa Maestro automated glycohemoglobin (HbA1c) HPLC analyzer (BioHermes BH60 OEM). ' +
      'ASTM E1394-97 over TCP/IP or RS232 serial. The analyzer runs as a TCP Server ' +
      '(PTS = TCP Server, Mode = ASTM S); Synapse connects to the analyzer IP:port as a ' +
      'TCP client and receives uploaded H/P/O/R/L result records (assay fixed "HbA1c"), ' +
      'posting the HbA1c value to the Noble LIS.',
    HBA1C_MAESTRO,
    {
      port: 55555,
      protocol: 'astm',
      mode: 'unidirectional',
      transports: ['tcp-client', 'tcp-server', 'serial'],
      maturity: 'beta',
      lisValueOnly: true,
      derivesEag: true,
      astmFlushOnTerminator: true,
      transientConnection: true
    }
  )
]

// ---------------------------------------------------------------------------
// HORIBA Medical - Yumizen H550 / H550E hematology (analyzer = TCP client).
// H550: ASTM LIS2-A2. H550E: HL7 v2.x (ORU^R01 over MLLP) — the analyzer's ASTM
// upload omits/relabels RDW and ESR at this site, so the H550E uses HL7 where the
// full parameter set (incl. RDW-SD/RDW-CV and ESR) is reported (per the HORIBA
// field engineer). Exact OBX layout to be confirmed against a captured frame.
// ---------------------------------------------------------------------------
const horiba = [
  mk(
    'horiba-yumizen-h550',
    'HORIBA Yumizen H550',
    'HORIBA Medical',
    'Hematology (CBC)',
    'Yumizen H550 auto hematology analyzer (CBC / 5-part DIFF). ASTM E1394 (LIS01-A2 + ' +
      'LIS2-A2) over Ethernet or RS232 serial (serial: 38400 8-N-1). On the analyzer set ' +
      'Home > Settings > System > General Communication > Host to the ASTM format and Network ' +
      'mode, then enter this server\'s IP + port in the Host Settings area (the analyzer ' +
      'connects out to the Host, so Synapse listens as a TCP server). Results upload as ' +
      'H/P/O/R/L records; each analyte is keyed by the Universal Test ID code in R field 9.3 ' +
      'component 4 (e.g. "^^^MON%^5905-5" -> MON%), the accession barcode rides in the O ' +
      'record Specimen ID, units follow the analyzer\'s Conventional unit system. The device ' +
      'also supports bidirectional host-query (Q/order download) and an HL7 format; this driver ' +
      'handles ASTM result upload first.',
    HORIBA_YUMIZEN,
    // Default host port 5678 — HORIBA's factory default for the ASTM/Network host
    // link (the analyzer Host tab ships pointing at :5678). Synapse listens here.
    { port: 5678, protocol: 'astm', mode: 'unidirectional', transports: ['tcp-server', 'serial'], maturity: 'beta' }
  ),
  mk(
    'horiba-yumizen-h550e',
    'HORIBA Yumizen H550E',
    'HORIBA Medical',
    'Hematology (CBC + ESR)',
    'Yumizen H550E auto hematology analyzer — same CBC / 5-part DIFF menu as the H550 plus an ' +
      'integrated ESR (Erythrocyte Sedimentation Rate, mm/h). Interfaces over HL7 v2.x ' +
      '(ORU^R01 over MLLP) so the full parameter set — including RDW-SD/RDW-CV and ESR — is ' +
      'reported; the analyzer\'s ASTM upload omits/relabels those. On the analyzer set Home > ' +
      'Settings > System > General Communication > Host to the HL7 format and Network mode, then ' +
      'point it at this server\'s IP + port (the analyzer connects out, so Synapse listens as a ' +
      'TCP server on the same host port). Results arrive as MSH/PID/OBR/OBX segments: the ' +
      'parameter set rides in OBX rows and the accession barcode in OBR-3 (or SPM-2). The exact ' +
      'OBX code layout (component 1 mnemonic vs LOINC^mnemonic) is verified per site from a ' +
      'captured frame; the default generic decoder reads the OBX-3 component-1 mnemonic.',
    combine(HORIBA_YUMIZEN, HORIBA_ESR),
    // Host port 5678 — HORIBA's factory default host-link port (the analyzer Host
    // tab ships pointing at :5678); unchanged by the ASTM->HL7 switch since MLLP
    // rides the same TCP stream. Synapse listens here.
    { port: 5678, protocol: 'hl7', hl7Dialect: 'horiba', mode: 'unidirectional', transports: ['tcp-server', 'serial'], maturity: 'beta' }
  )
]

// ---------------------------------------------------------------------------
// Mindray - BS-series clinical chemistry (ASTM E1394, "mindray" dialect)
// ---------------------------------------------------------------------------
const mindray = [
  ...family(
    [
      ['mindray-bs-200', 'Mindray BS-200'],
      ['mindray-bs-240', 'Mindray BS-240'],
      ['mindray-bs-330', 'Mindray BS-330E'],
      ['mindray-bs-350', 'Mindray BS-350E'],
      ['mindray-bs-380', 'Mindray BS-380'],
      ['mindray-bs-400', 'Mindray BS-400'],
      ['mindray-bs-420', 'Mindray BS-420'],
      ['mindray-bs-430', 'Mindray BS-430'],
      ['mindray-bs-480', 'Mindray BS-480']
    ],
    'Mindray',
    'Clinical Chemistry',
    'Mindray BS-series automatic biochemistry analyzer. ASTM E1381/E1394 over RS-232 serial ' +
      '(default 9600 8-N-1) or TCP/IP. Bidirectional host-query: the analyzer sends an ASTM ' +
      'Query (H "RQ" + Q record) with the sample barcode, Synapse looks the barcode up in the ' +
      'Noble LIS and answers with an "SA" order download (all ordered tests in a single O record, ' +
      'each as CODE^^2^1). Results upload as H "PR" + P/O/R records — the accession barcode rides ' +
      'in the O record Specimen ID (field 4), and each analyte code/value is component 1 of the R ' +
      'record test-id / value fields. Verified against a live eLABS BS430 interface capture.',
    MINDRAY_BS_CHEM,
    {
      // Host link is RS-232 serial on the analyzer (COM port); reach it over LAN
      // via a serial-to-Ethernet device server, or use TCP where supported.
      port: 9104,
      protocol: 'astm',
      mode: 'bidirectional',
      transports: ['serial', 'tcp-server', 'tcp-client'],
      astmDialect: 'mindray',
      maturity: 'skeleton'
    },
    // BS-430 is the model validated against captured traffic; the siblings share
    // the identical ASTM dialect but are not individually verified yet.
    ['mindray-bs-430']
  )
]

// ---------------------------------------------------------------------------
// Generic fallback (keeps id 'generic-astm')
// ---------------------------------------------------------------------------
const generic = [
  mk(
    'generic-astm',
    'Generic ASTM / HL7 Analyzer',
    'Generic',
    'Universal',
    'Standards-based fallback driver for any analyzer speaking ASTM E1394 or HL7 v2.x. Use for bring-up before a model-specific driver exists.',
    combine(CHEMISTRY, ELECTROLYTES, CBC),
    { port: 9200, protocol: 'astm', mode: 'unidirectional', transports: ['tcp-server', 'tcp-client', 'serial'], maturity: 'stable' }
  )
]

export const CATALOG: ModelDefinition[] = [
  ...maglumi,
  ...snibeOther,
  ...getein,
  ...geteinMetis,
  ...edan,
  ...boule,
  ...beckman,
  ...landwind,
  ...agappe,
  ...horiba,
  ...mindray,
  ...generic
]
