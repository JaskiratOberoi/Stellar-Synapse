import { randomUUID } from 'node:crypto'
import type { CanonicalResult, ResultFlag } from '../../../shared/types'
import type { ProtocolMessage } from '../protocols/IProtocol'
import { Hl7Protocol } from '../protocols/hl7'
import type { DriverAnalyte } from './IInstrumentDriver'
import { simValue } from './sampleBuilders'

/**
 * Abbott Alinity ci-series — HL7 v2.5.1 / IHE LAW over MLLP.
 *
 * Decoded from "Alinity ci-series LIS Interface Manual (HL7)", 80000455-106
 * (2025-02-04). The analyzer implements the IHE Laboratory Analytical Workflow
 * (LAW) profile, which differs from every other HL7 analyzer Synapse speaks to
 * in three ways that shape this module:
 *
 *  1. TWO MLLP channels, each one-directional at the application level.
 *     - "Client channel": the analyzer initiates. It sends QBP^Q11 order queries,
 *       OUL^R22 results / test-status updates, OUL^R24 calibrations, SSU^U03
 *       sample status, TCU^U10 assay availability, NMD^N02 connection tests and
 *       EAR^U08 command responses, and expects an application-level ACK (RSP^K11
 *       / ACK^xx) on the SAME connection within its time-out — otherwise it
 *       retries and finally DISABLES its HL7 link. So every inbound event is
 *       acknowledged, whether or not host query is enabled.
 *     - "Server channel": the LIS initiates. Orders are downloaded as OML^O33
 *       (one ORC/TQ1/OBR group per test) and the analyzer answers ORL^O34 with a
 *       per-test accept (OK/SC) or reject (UA). A query that has no orders is
 *       answered with a NEGATIVE query response: an OML^O33 whose ORC-1 is DC and
 *       SPM-11 is U. The RSP^K11 to a query is only a receipt — it never carries
 *       the order itself.
 *  2. Tests are identified by Abbott ASSAY NUMBER (OBR-4.1 / OBX-3.1, coding
 *     system 99ABT), not by name; the name rides in component 2 and the receiver
 *     ignores it. Assay numbers are per-assay (and may differ between assay
 *     versions), so they are LEARNED from live traffic (results and the periodic
 *     TCU^U10 assay-availability list) into each mapping rule's analyzerCode and
 *     used for the order download; results are filed by the assay NAME.
 *  3. A result is a group of OBX segments: the primary numeric value (OBX-3.1 =
 *     "<no>", OBX-2 ST), an optional interpretation ("<no>.I"), a raw RLU/Abs
 *     ("<no>.R", supplemental) and a result GUID ("<no>.G"). Exceptions come as
 *     OBX-2 CE / OBX-11 X with the error text in OBX-5. Control (SPM-11 Q) and
 *     calibrator (C) specimens are not patient results.
 */

export type AlinityHl7Dialect = 'abbott-law'

/** MSH is special: after split on '|', element[N-1] is field MSH-N (N>=2). */
function mshField(message: ProtocolMessage, fieldNo: number): string {
  const msh = message.records.find((r) => (r[0] || '').toUpperCase() === 'MSH')
  return (msh?.[fieldNo - 1] || '').trim()
}

function seg(message: ProtocolMessage, type: string): string[] | undefined {
  return message.records.find((r) => (r[0] || '').toUpperCase() === type)
}

/** First component of an HL7 field ("249^TSH^99ABT" -> "249"). */
function c1(field: string | undefined): string {
  return (field || '').split('^')[0].trim()
}

/** HL7 timestamp YYYYMMDDHHMMSS (local; the analyzer ignores time zones on receive). */
export function alinityStamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** MSH-9 message type, e.g. "OUL^R22^OUL_R22". */
export function alinityMessageType(message: ProtocolMessage): string {
  return mshField(message, 9).toUpperCase()
}

/** MSH-9 trigger event, e.g. "R22" for OUL^R22, "U03" for SSU^U03. */
export function alinityTrigger(message: ProtocolMessage): string {
  return (alinityMessageType(message).split('^')[1] || '').trim()
}

/** MSH-10 control id (echoed in MSA-2 of our acknowledgment). */
export function alinityControlId(message: ProtocolMessage): string {
  return mshField(message, 10) || '0'
}

/** Is this an HL7 message from an Alinity-style LAW sender at all? */
export function isAlinityHl7(message: ProtocolMessage): boolean {
  return message.protocol === 'hl7' && !!seg(message, 'MSH')
}

/**
 * MSH-3..6 of the analyzer's message. The instrument fills MSH-3/4 from its own
 * configuration and MSH-5/6 with what it expects the LIS to be called; for
 * acknowledgments it echoes the inbound MSH-5/6 back as MSH-3/4. We mirror that:
 * our MSH-3/4 = its MSH-5/6, our MSH-5/6 = its MSH-3/4.
 */
export interface AlinityPeer {
  sendingApp: string
  sendingFacility: string
  receivingApp: string
  receivingFacility: string
}

export function alinityPeer(message: ProtocolMessage): AlinityPeer {
  return {
    sendingApp: mshField(message, 3),
    sendingFacility: mshField(message, 4),
    receivingApp: mshField(message, 5),
    receivingFacility: mshField(message, 6)
  }
}

// ---------------------------------------------------------------------------
// Inbound: results (OUL^R22)
// ---------------------------------------------------------------------------

/**
 * Map the Alinity OBX-8 interpretation codes (HL7 table 0078 + Abbott
 * extensions) to a canonical flag. The field repeats ("LOW^^99ABT~EXP^^99ABT");
 * the first range flag wins. Reagent/calibration/Westgard flags carry no range
 * meaning and yield no flag.
 */
export function alinityFlag(obx8: string | undefined): ResultFlag | undefined {
  if (!obx8) return undefined
  for (const rep of obx8.split('~')) {
    const code = c1(rep).toUpperCase()
    if (code === 'LOW') return 'L'
    if (code === 'HIGH') return 'H'
    if (code === 'LL' || code === '<') return 'LL'
    if (code === 'HH' || code === '>' || code === 'PSHH') return 'HH'
  }
  return undefined
}

/** Specimen role from SPM-11: P patient, Q control, C calibrator, U unknown. */
export function alinitySpecimenRole(message: ProtocolMessage): string {
  const spm = seg(message, 'SPM')
  return c1(spm?.[11]).toUpperCase()
}

/** SAC-3 container id = the sample barcode the LIS order is keyed by. */
export function alinitySampleId(message: ProtocolMessage): string {
  const sac = seg(message, 'SAC')
  return c1(sac?.[3])
}

/**
 * One OBX-3 identifier decoded: "249" / "249.I" / "0241.R^ANTI-Hcv^99ABT^S_RAW…".
 * `assayNo` is the bare assay number; `kind` tells the result part.
 */
export interface AlinityObxId {
  assayNo: string
  name: string
  kind: 'primary' | 'interpretation' | 'raw' | 'guid' | 'other'
}

export function parseAlinityObxId(obx3: string | undefined): AlinityObxId | null {
  const parts = (obx3 || '').split('^')
  const ident = (parts[0] || '').trim()
  if (!ident) return null
  const m = /^(\d+)(?:\.([A-Z]))?$/i.exec(ident)
  if (!m) return null
  const suffix = (m[2] || '').toUpperCase()
  const kind: AlinityObxId['kind'] =
    suffix === '' ? 'primary' : suffix === 'I' ? 'interpretation' : suffix === 'R' ? 'raw' : suffix === 'G' ? 'guid' : 'other'
  return { assayNo: m[1], name: (parts[1] || '').trim(), kind }
}

/** A test exception reported by the analyzer (OBX-2 CE, OBX-11 X). */
export interface AlinityException {
  sampleId: string
  assayNo: string
  name: string
  code: string
  text: string
}

/**
 * Exceptions the analyzer reported instead of a value, so the operator can see
 * WHY a test produced nothing ("Unable to process test; no processing module
 * available"). Patient specimens only.
 */
export function extractAlinityExceptions(message: ProtocolMessage): AlinityException[] {
  if (!alinityMessageType(message).startsWith('OUL^R22')) return []
  if (alinitySpecimenRole(message) !== 'P') return []
  const sampleId = alinitySampleId(message)
  const out: AlinityException[] = []
  for (const s of message.records) {
    if ((s[0] || '').toUpperCase() !== 'OBX') continue
    // A result-type (OBX-29 RSLT) coded entry with status X. A test-status update
    // (OBX-29 STS, e.g. INITIATED with status I) is also CE but not an exception.
    if ((s[29] || '').trim().toUpperCase() !== 'RSLT') continue
    if ((s[11] || '').trim().toUpperCase() !== 'X') continue
    if ((s[2] || '').trim().toUpperCase() !== 'CE') continue
    const id = parseAlinityObxId(s[3])
    if (!id || id.kind !== 'primary') continue
    const val = (s[5] || '').split('^')
    out.push({
      sampleId,
      assayNo: id.assayNo,
      name: id.name,
      code: (val[0] || '').trim(),
      text: (val[1] || '').trim()
    })
  }
  return out
}

/**
 * Parse an Alinity `OUL^R22` results upload into canonical results.
 *
 * Only PATIENT specimens (SPM-11 = P) with a FINAL primary result (OBX-29 RSLT,
 * OBX-11 F, OBX-2 ST, OBX-3.1 a bare assay number) become results; the
 * interpretation part ("<no>.I", e.g. REACTIVE for a qualitative assay) is
 * surfaced as its own analyte "<name>.I" so a lab can file either the index or
 * the interpretation. Raw RLU / GUID supplemental rows, exceptions (CE/X),
 * controls, calibrators, test-status updates (OBX-29 STS) and calibration
 * messages (OUL^R24) yield nothing.
 *
 * Results are keyed by the assay NAME (OBX-3.2); the assay NUMBER (OBX-3.1)
 * travels in `analyzerCode` on the mapping rule, learned by the Orchestrator
 * from the same message, and is what the order download sends back.
 */
export function parseAlinityHl7(message: ProtocolMessage, instrumentId: string): CanonicalResult[] {
  if (!alinityMessageType(message).startsWith('OUL^R22')) return []
  if (alinitySpecimenRole(message) !== 'P') return []
  const sampleId = alinitySampleId(message)
  if (!sampleId) return []
  const now = new Date().toISOString()
  const results: CanonicalResult[] = []

  for (const s of message.records) {
    if ((s[0] || '').toUpperCase() !== 'OBX') continue
    // OBX-29 observation type: RSLT = a result, STS = a test-status update.
    if ((s[29] || '').trim().toUpperCase() !== 'RSLT') continue
    if ((s[11] || '').trim().toUpperCase() !== 'F') continue
    if ((s[2] || '').trim().toUpperCase() !== 'ST') continue
    const id = parseAlinityObxId(s[3])
    if (!id || (id.kind !== 'primary' && id.kind !== 'interpretation')) continue
    const value = (s[5] || '').trim()
    if (!value) continue
    const units = (s[6] || '').split('^')
    const unit = (units[1] || units[0] || '').trim() || undefined
    const ref = (s[7] || '').trim()
    const code = id.kind === 'interpretation' ? `${id.name}.I` : id.name
    results.push({
      id: randomUUID(),
      instrumentId,
      sampleId,
      analyteCode: code || id.assayNo,
      analyteName: id.kind === 'interpretation' ? `${id.name} (interpretation)` : id.name || undefined,
      value,
      unit: id.kind === 'interpretation' ? undefined : unit,
      referenceRange: ref && ref !== '""' ? ref : undefined,
      flag: alinityFlag(s[8]),
      measuredAt: (s[19] || '').trim() || undefined, // OBX-19 date/time of the analysis
      receivedAt: now
    })
  }
  return results
}

// ---------------------------------------------------------------------------
// Assay-number learning (OUL^R22 OBR-4 / OBX-3, TCU^U10 TCC-1)
// ---------------------------------------------------------------------------

export interface AlinityAssay {
  /** Abbott assay number (OBR-4.1 / OBX-3.1 / TCC-1.1). */
  assayNo: string
  /** Assay name as the instrument prints it (OBR-4.2 / OBX-3.2 / TCC-1.2). */
  name: string
  /** TCU^U10 only: A available / U unavailable. */
  availability?: 'A' | 'U'
}

/**
 * Every (assay number, name) pair a message carries. Results name the assay in
 * OBR-4 and every OBX-3; the periodic assay-availability message (TCU^U10)
 * lists every installed, enabled assay in TCC-1 with its status in TCC-14.
 */
export function extractAlinityAssays(message: ProtocolMessage): AlinityAssay[] {
  const byNo = new Map<string, AlinityAssay>()
  const add = (field: string | undefined, availability?: 'A' | 'U'): void => {
    const parts = (field || '').split('^')
    const no = (parts[0] || '').trim().split('.')[0]
    const name = (parts[1] || '').trim()
    if (!/^\d+$/.test(no) || !name) return
    const prev = byNo.get(no)
    byNo.set(no, { assayNo: no, name, availability: availability ?? prev?.availability })
  }
  for (const s of message.records) {
    const t = (s[0] || '').toUpperCase()
    if (t === 'OBR') add(s[4])
    else if (t === 'OBX') add(s[3])
    else if (t === 'TCC') {
      const avail = c1(s[14]).toUpperCase()
      add(s[1], avail === 'A' || avail === 'U' ? avail : undefined)
    }
  }
  return [...byNo.values()]
}

// ---------------------------------------------------------------------------
// Inbound: order query (QBP^Q11) and its receipt (RSP^K11)
// ---------------------------------------------------------------------------

export interface AlinityQuery {
  /** Sample barcode (QPD-3 container id). */
  sid: string
  /** QPD-2 query tag, echoed in QAK-1 / QPD-2 of the response. */
  queryTag: string
  /** MSH-10 of the query, echoed in MSA-2. */
  controlId: string
  peer: AlinityPeer
}

/** Recognize a `QBP^Q11` work-order-step query, else null. */
export function parseAlinityQuery(message: ProtocolMessage): AlinityQuery | null {
  if (message.protocol !== 'hl7') return null
  if (!alinityMessageType(message).startsWith('QBP^Q11')) return null
  const qpd = seg(message, 'QPD')
  const sid = c1(qpd?.[3])
  if (!sid) return null
  return {
    sid,
    queryTag: (qpd?.[2] || '').trim(),
    controlId: alinityControlId(message),
    peer: alinityPeer(message)
  }
}

const CR = '\r'
const WOS = 'WOS^Work Order Step^IHELAW'

/**
 * Our MSH for a message TO the analyzer. Mirrors the manual's examples field for
 * field: MSH-11 P, MSH-12 2.5.1, MSH-18 "UNICODE UTF-8" (the space matters),
 * MSH-15/16 NE/AL on event-triggered messages, MSH-21 the LAW transaction.
 */
function msh(opts: {
  type: string
  controlId: string
  peer?: AlinityPeer
  event: boolean
  profile?: string
  stamp?: string
}): string {
  // Responses echo the inbound MSH-5/6 as our MSH-3/4 (empty when the analyzer
  // sent none, exactly as the manual's RSP^K11 example); event messages we
  // originate name ourselves when the analyzer has not told us what it calls us.
  const f = [
    'MSH',
    '^~\\&',
    opts.peer?.receivingApp || (opts.event && !opts.peer ? 'SYNAPSE' : ''),
    opts.peer?.receivingFacility || '',
    opts.peer?.sendingApp || '',
    opts.peer?.sendingFacility || '',
    opts.stamp ?? alinityStamp(),
    '',
    opts.type,
    opts.controlId,
    'P',
    '2.5.1',
    '',
    '',
    opts.event ? 'NE' : '',
    opts.event ? 'AL' : '',
    '',
    'UNICODE UTF-8'
  ]
  if (opts.profile) f.push('', '', opts.profile)
  return f.join('|')
}

/**
 * `RSP^K11` receipt for a query: acknowledges the QBP only. The orders (or the
 * negative response) follow separately as an OML^O33 on the order channel.
 * Mirrors the manual's example (MSA, QAK <tag>|OK|WOS, QPD echoed; NE/AL set).
 */
export function buildAlinityQueryResponse(
  query: AlinityQuery,
  opts?: { controlId?: string; stamp?: string }
): string {
  return (
    [
      msh({
        type: 'RSP^K11^RSP_K11',
        controlId: opts?.controlId ?? randomUUID(),
        peer: query.peer,
        event: true,
        profile: 'LAB-27^IHE',
        stamp: opts?.stamp
      }),
      `MSA|AA|${query.controlId}`,
      `QAK|${query.queryTag}|OK|${WOS}`,
      `QPD|${WOS}|${query.queryTag}|${query.sid}`
    ].join(CR) + CR
  )
}

/**
 * Application acknowledgment for any event the analyzer sends on its client
 * channel: OUL^R22 (results / status) -> ACK^R22, OUL^R24 -> ACK^R24, SSU^U03 ->
 * ACK^U03, NMD^N02 -> ACK^N02, TCU^U10 -> ACK^U10, EAR^U08 -> ACK^U08. MSA-1 AA
 * accepts every result in the message (there is no partial accept). MSH-21 is
 * echoed only when the inbound carried one (LAB-29 for OUL^R22).
 */
export function buildAlinityAck(
  message: ProtocolMessage,
  opts?: { controlId?: string; stamp?: string }
): string {
  const trigger = alinityTrigger(message) || 'R22'
  const profile = mshField(message, 21) || undefined
  return (
    [
      msh({
        type: `ACK^${trigger}^ACK`,
        controlId: opts?.controlId ?? randomUUID(),
        peer: alinityPeer(message),
        event: false,
        profile,
        stamp: opts?.stamp
      }),
      `MSA|AA|${alinityControlId(message)}`
    ].join(CR) + CR
  )
}

/** Events on the client channel that need an application ACK (ACK^<trigger>). */
export function alinityNeedsAck(message: ProtocolMessage): boolean {
  const t = alinityMessageType(message)
  return /^(OUL\^R22|OUL\^R24|SSU\^U03|NMD\^N02|TCU\^U10|EAR\^U08)/.test(t)
}

// ---------------------------------------------------------------------------
// Outbound: order download (OML^O33) and its response (ORL^O34)
// ---------------------------------------------------------------------------

export interface AlinityOrderTest {
  /** Abbott assay number (OBR-4.1). */
  assayNo: string
  /** Assay name (OBR-4.2) — informational, the analyzer ignores it. */
  name?: string
  /** AWOS id (OBR-2); generated when omitted. */
  awosId?: string
  priority?: 'R' | 'S'
}

export interface AlinityOrder {
  sid: string
  tests: AlinityOrderTest[]
  patient?: { id?: string; name?: string }
  peer?: AlinityPeer
  controlId?: string
  stamp?: string
}

/**
 * Analytical Work Order Step id for one test on one specimen: unique across the
 * analyzer's order database (a repeat NW for an AWOS id it already holds is
 * rejected), <= 50 chars.
 */
export function alinityAwosId(sid: string, assayNo: string, stamp = alinityStamp()): string {
  return `${sid}-${assayNo}-${stamp}`.slice(0, 50)
}

/**
 * `OML^O33` order download for one specimen. One ORC/TQ1/OBR group per test
 * (ORC-1 NW, ORC-9 transaction time, TQ1-9 priority, OBR-2 AWOS id, OBR-4
 * <assayNo>^<name>^99ABT), after SPM (role P) and SAC (the barcode). With NO
 * tests this is the NEGATIVE query response the analyzer waits for after a
 * QBP^Q11 it got nothing for: SPM-11 U, ORC-1 DC, no OBSERVATION REQUEST group.
 * Mirrors the manual's Appendix A examples segment for segment.
 */
export function buildAlinityOrderDownload(order: AlinityOrder): string {
  const stamp = order.stamp ?? alinityStamp()
  const lines: string[] = [
    msh({
      type: 'OML^O33^OML_O33',
      controlId: order.controlId ?? randomUUID(),
      peer: order.peer,
      event: true,
      profile: 'LAB-28^IHE',
      stamp
    })
  ]
  if (order.tests.length === 0) {
    lines.push('SPM|1|||""|||||||U^Unknown^HL70369', `SAC|||${order.sid}`, `ORC|DC||||||||${stamp}`)
    return lines.join(CR) + CR
  }
  if (order.patient?.name || order.patient?.id) {
    // PID-3 patient id, PID-5 name (family name component only — the analyzer
    // shows it, nothing downstream parses it).
    const name = (order.patient.name ?? '').replace(/[|^~\\&]/g, ' ').trim()
    lines.push(`PID|||${order.patient.id ?? ''}||${name}`)
  }
  lines.push('SPM|1|||""|||||||P^Patient^HL70369', `SAC|||${order.sid}`)
  for (const t of order.tests) {
    const pr = t.priority === 'S' ? 'S^Stat^HL70485' : 'R^Routine^HL70485'
    lines.push(
      `ORC|NW||||||||${stamp}`,
      `TQ1|1||||||||${pr}`,
      `OBR||${t.awosId ?? alinityAwosId(order.sid, t.assayNo, stamp)}||${t.assayNo}^${t.name ?? ''}^99ABT`
    )
  }
  return lines.join(CR) + CR
}

export interface AlinityOrderResponse {
  /** MSA-1: AA accepted, AE malformed, AR rejected. */
  ack: string
  /** MSA-2: the OML's control id. */
  controlId: string
  /** ERR-3 / ERR-5 text when the message was rejected. */
  error?: string
  /** Per test: ORC-1 OK (accepted) / UA (rejected) / CR (cancelled) / UC (cancel refused). */
  orders: { awosId: string; control: string; status: string }[]
}

/** Recognize an `ORL^O34` order response, else null. */
export function parseAlinityOrderResponse(message: ProtocolMessage): AlinityOrderResponse | null {
  if (message.protocol !== 'hl7') return null
  if (!alinityMessageType(message).startsWith('ORL^O34')) return null
  const msa = seg(message, 'MSA')
  const err = seg(message, 'ERR')
  const orders: AlinityOrderResponse['orders'] = []
  for (const s of message.records) {
    if ((s[0] || '').toUpperCase() !== 'ORC') continue
    orders.push({ control: (s[1] || '').trim().toUpperCase(), awosId: c1(s[2]), status: (s[5] || '').trim().toUpperCase() })
  }
  // ERR-3 HL7 error code (code^text), ERR-5 application error code (code^text),
  // ERR-8 user message — whichever the analyzer filled.
  const errText = err
    ? [err[3], err[5], err[8]]
        .map((f) => (f || '').split('^').map((x) => x.trim()).filter(Boolean).join(' '))
        .filter(Boolean)
        .join(' — ')
    : ''
  return {
    ack: (msa?.[1] || '').trim().toUpperCase(),
    controlId: (msa?.[2] || '').trim(),
    error: errText || undefined,
    orders
  }
}

/** `NMD^N02` connection test we can send on the order channel (expects ACK^N02). */
export function buildAlinityConnectionTest(peer?: AlinityPeer, controlId = randomUUID()): string {
  return [msh({ type: 'NMD^N02^NMD_N02', controlId, peer, event: true }), 'NST|N'].join(CR) + CR
}

/** Wrap an HL7 message body in MLLP framing (<VT>…<FS><CR>). */
export function frameAlinityHl7(body: string): Buffer {
  return Hl7Protocol.frame(body)
}

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

/**
 * Build an `OUL^R22` results upload for the simulator, in the manual's layout:
 * SPM (P), SAC (barcode), then per analyte OBR / ORC SC CM / TQ1 / OBX RSLT with
 * a pseudo assay number derived from the analyte code so the learning path has
 * something to pick up.
 */
export function buildAlinityHl7Sample(
  sampleId: string,
  instrumentName: string,
  analytes: DriverAnalyte[]
): string {
  const stamp = alinityStamp()
  const lines: string[] = [
    `MSH|^~\\&|${instrumentName}|Lab|SYNAPSE|LIS|${stamp}||OUL^R22^OUL_R22|${randomUUID()}|P|2.5.1|||NE|AL||UNICODE UTF-8|||LAB-29^IHE`,
    'SPM|1|||""|||||||P^Patient^HL70369',
    `SAC|||${sampleId}|||||||S5501|1||||1^Position^99ABT~1^Module^99ABT`
  ]
  analytes.forEach((a, i) => {
    const { value, flag } = simValue(a)
    // Deterministic pseudo assay number: 100 + a stable hash of the code.
    let h = 0
    for (const ch of a.code) h = (h * 31 + ch.charCodeAt(0)) & 0xffff
    const no = String(100 + (h % 900))
    const abbFlag = flag === 'H' ? 'HIGH^^99ABT' : flag === 'L' ? 'LOW^^99ABT' : '""'
    lines.push(
      `OBR||${alinityAwosId(sampleId, no, stamp)}||${no}^${a.code}^99ABT`,
      'ORC|SC||||CM',
      'TQ1|||||||||R^Routine^HL70485',
      `OBX|${i + 1}|ST|${no}^${a.code}^99ABT|1|${value}|^${a.unit ?? ''}|${a.sim?.ref ?? '""'}|${abbFlag}|||F|||||Admin~Admin||${instrumentName}^Abbott~i00001^Abbott|${stamp}||||||||||RSLT`,
      `TCD|${no}^${a.code}^99ABT||||||||||UNDILUTED^^99ABT`
    )
  })
  return lines.join(CR)
}
