import { randomUUID } from 'node:crypto'
import type { CanonicalResult, ResultFlag } from '../../../shared/types'
import type { ProtocolMessage } from '../protocols/IProtocol'
import type { DriverAnalyte } from './IInstrumentDriver'
import { simValue } from './sampleBuilders'

/**
 * Mindray BS-series clinical-chemistry ASTM dialect (BS-200/240/330/380/400/
 * 420/430/480, …).
 *
 * Decoded from a live eLABS/ElabAssistLite interface (Genomic Labs, BS430BI,
 * 2026-07 logs). The BS-430 speaks ASTM E1381 framing + E1394 records over
 * RS-232 serial (COM7, 9600 8-N-1) or TCP, but its field layout differs from
 * the "standard" ASTM the generic decoder assumes, so it needs its own parse +
 * order-download builder:
 *
 * 1. QUERY (analyzer -> host), H field 12 = "RQ":
 *      H|\^&|||Mindry^^|||||||RQ|1394-97|<ts>
 *      Q|221|^8454133||||||||||O          <- queried barcode in Q field 3 ("^SID")
 *      L|87|N
 *    Handled by the shared `extractAstmQuery` (Q field 3, first caret component).
 *
 * 2. ORDER DOWNLOAD (host -> analyzer), H field 12 = "SA" — Synapse's reply:
 *      H|\^&||| Product Model^01.03.07.03^123456|||||||SA|1394-97|<ts>
 *      P|1
 *      O|1|1^1^1|<SID>|CODE1^^2^1\CODE2^^2^1\...|R|<ts>|<ts>||||||||serum|||1|||||||Q|||||
 *      L|1|N
 *    All tests ride in ONE O record, field 5, joined by the ASTM repeat
 *    delimiter "\"; each universal test id is `CODE^^2^1` (code in component 1 —
 *    NOT the standard "^^^CODE"). The SID rides in the O Specimen ID (field 4).
 *    Framed as a single standard E1381 frame (frame no. 1 + checksum), verified
 *    byte-for-byte against the reference (`frameMindrayMessage`).
 *
 * 3. RESULT UPLOAD (analyzer -> host), H field 12 = "PR":
 *      H|\^&|||Mindry^^|||||||PR|1394-97|<ts>
 *      P|796||PATIENT111||ABC^^||19600315^66^Y|M||...
 *      O|796|9058^1^11|8766097|SGOT^...^^\...|R|...|F
 *      R|241|SGOT^Aspartate Aminotransferase^^F|67.983848^^^^|U/L|^|N||F|...|20260704000931||Mindry^
 *      L|100|N
 *    In the O record the barcode is field 4 (Specimen ID); field 3 is the
 *    instrument's internal sample no. (seq^rack^pos), NOT the barcode. In each R
 *    record the analyte code is component 1 of the test id (field 3) and the
 *    value is component 1 of the value field (field 4, e.g. "67.983848^^^^").
 */

// ---------------------------------------------------------------------------
// Analyte panel — instrument codes EXACTLY as the BS-430 transmits them in the
// R-record test id (component 1) and requests in its order query. Names/units
// mirror the captured traffic; the mapping engine resolves these to LIS tests.
// ---------------------------------------------------------------------------
const a = (
  code: string,
  name: string,
  unit: string,
  min: number,
  max: number,
  decimals = 2,
  ref?: string
): DriverAnalyte => ({ code, name, unit, sim: { min, max, decimals, ref: ref ?? `${min} to ${max}` } })

export const MINDRAY_BS_CHEM: DriverAnalyte[] = [
  a('GLU', 'Glucose', 'mg/dL', 70, 100, 0),
  a('UREA', 'Urea', 'mg/dL', 15, 40, 0),
  a('CREAT', 'Creatinine', 'mg/dL', 0.7, 1.3),
  a('URIC', 'Uric Acid', 'mg/dL', 3.5, 7.2, 1),
  a('BIT', 'Total Bilirubin', 'mg/dL', 0.3, 1.2),
  a('BID', 'Direct Bilirubin', 'mg/dL', 0, 0.3),
  a('SGPT', 'Alanine Aminotransferase (ALT)', 'U/L', 7, 56, 0),
  a('SGOT', 'Aspartate Aminotransferase (AST)', 'U/L', 5, 40, 0),
  a('ALP', 'Alkaline Phosphatase', 'U/L', 44, 147, 0),
  a('GGT', 'Gamma GT', 'U/L', 8, 61, 0),
  a('TP', 'Total Protein', 'g/dL', 6.4, 8.3, 1),
  a('ALB', 'Albumin', 'g/dL', 3.5, 5.2, 1),
  a('CHOL', 'Total Cholesterol', 'mg/dL', 125, 200, 0),
  a('TC', 'Total Cholesterol (calc.)', 'mg/dL', 125, 200, 0),
  a('TRIG', 'Triglycerides', 'mg/dL', 50, 150, 0),
  a('TG', 'Triglycerides (alt.)', 'mg/dL', 50, 150, 0),
  a('HDL', 'HDL Cholesterol', 'mg/dL', 40, 60, 0),
  a('LDL', 'LDL Cholesterol', 'mg/dL', 50, 130, 0),
  a('CAL', 'Calcium', 'mg/dL', 8.6, 10.2, 1),
  a('Iron', 'Iron (Serum)', 'ug/dL', 60, 170, 0),
  a('TIBC', 'Total Iron Binding Capacity', 'ug/dL', 250, 450, 0),
  a('UIBC', 'Unsaturated Iron Binding Capacity', 'ug/dL', 110, 370, 0)
]

// ---------------------------------------------------------------------------
// Parsing (analyzer -> canonical results)
// ---------------------------------------------------------------------------

function normFlag(raw?: string): ResultFlag | undefined {
  if (!raw) return undefined
  const f = raw.trim().toUpperCase()
  if (['N', 'H', 'L', 'HH', 'LL', 'A'].includes(f)) return f as ResultFlag
  return undefined
}

/** Strip caret-only placeholder ranges ("^", "^^") to undefined. */
function cleanRange(raw?: string): string | undefined {
  const r = (raw ?? '').replace(/\^/g, '').trim()
  return r.length > 0 ? r : undefined
}

/**
 * Round a BS-series result value to 2 decimals and trim trailing zeros, matching
 * the live eLABS/ElabAssistLite interface (verified against its logDetails
 * uploads: 67.983848 -> 67.98, 8.196338 -> 8.2, 72.999741 -> 73, 90.648357 ->
 * 90.65, 126.198530 -> 126.2). The BS-430 transmits 6-decimal raw values; the
 * reference interface always posts them rounded to 2 dp. Non-numeric/empty
 * values pass through unchanged. (Unlike eLABS — which left negatives raw via a
 * rounding-path bug — negatives are rounded too; we don't replicate the bug.)
 */
function round2(raw: string): string {
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(n)) return raw.trim()
  return n.toFixed(2).replace(/\.?0+$/, '')
}

/** Parse a Mindray BS-series ASTM result message into canonical results. */
export function parseMindrayAstm(message: ProtocolMessage, instrumentId: string): CanonicalResult[] {
  const results: CanonicalResult[] = []
  let currentSample = ''
  const now = new Date().toISOString()

  for (const rec of message.records) {
    const type = (rec[0] || '').toUpperCase()
    if (type === 'O') {
      // Mindray BS-series: the accession barcode (Specimen ID) is in field 4;
      // field 3 is the instrument's internal sample no. (seq^rack^pos), NOT the
      // barcode. Fall back to field 3 only if field 4 is empty.
      const specimen = (rec[3] || '').split('^')[0].trim()
      const fallback = (rec[2] || '').split('^')[0].trim()
      currentSample = specimen || fallback || ''
    } else if (type === 'R') {
      // Test id (field 3): "CODE^Name^^ResultType" — code in component 1.
      const idParts = (rec[2] || '').split('^')
      const code = (idParts[0] || '').trim()
      if (!code) continue
      const name = (idParts[1] || '').trim() || undefined
      // Value (field 4): "12.34^^^^" — numeric value in component 1, rounded to
      // 2 dp to match the reference eLABS interface's LIS uploads.
      const value = round2((rec[3] || '').split('^')[0].trim())
      results.push({
        id: randomUUID(),
        instrumentId,
        sampleId: currentSample,
        analyteCode: code,
        analyteName: name,
        value,
        unit: (rec[4] || '').trim() || undefined,
        referenceRange: cleanRange(rec[5]),
        flag: normFlag(rec[6]),
        // Instrument-reported completion time rides in field 12 (index 11).
        measuredAt: rec[11]?.trim() ? rec[11].trim() : undefined,
        receivedAt: now
      })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Order download (host -> analyzer) — answer a host query
// ---------------------------------------------------------------------------

const STX = 0x02
const ETX = 0x03

function ts(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`
}

/**
 * Build the ASTM order records that answer a BS-series host query for `sid` with
 * the given instrument analyte codes. Mirrors the proven eLABS "SA" download:
 * ALL ordered tests ride in a SINGLE O record (field 5), each as `CODE^^2^1`
 * joined by the ASTM repeat delimiter "\", and the barcode rides in the O
 * Specimen ID (field 4). A minimal `P|1` patient record is sent — the analyzer
 * keys the order to the sample by the O Specimen ID, so patient demographics are
 * not required (the reference's `PATIENT111`/`ABC^XYZ^j` were test placeholders).
 */
export function buildMindrayOrderRecords(sid: string, analyteCodes: string[]): string[][] {
  const now = ts()
  const tests = analyteCodes.map((code) => `${code}^^2^1`).join('\\')
  // Field layout reproduced byte-for-byte from the captured "SA" order frame.
  const h = `H|\\^&||| Product Model^01.03.07.03^123456|||||||SA|1394-97|${now}`
  const p = `P|1`
  const o = `O|1|1^1^1|${sid}|${tests}|R|${now}|${now}||||||||serum|||1|||||||Q|||||`
  const l = `L|1|N`
  return [h, p, o, l].map((rec) => rec.split('|'))
}

/**
 * Frame the order records as ONE standard ASTM E1381 frame, exactly as the
 * BS-430 expects (verified against the captured order download):
 *
 *   <STX>1 H|... <CR> P|1 <CR> O|... <CR> L|1|N <CR> <ETX> C1 C2 <CR> <LF>
 *
 * Frame number "1", records CR-separated, a CR before the ETX, then a 2-hex
 * checksum over everything after STX up to and including ETX. The caller
 * (`AstmHostQuerySender.sendFrames`) adds the leading <ENQ> and trailing <EOT>.
 */
export function frameMindrayMessage(records: string[][]): Buffer[] {
  const frameNum = 1
  const text = records.map((r) => r.join('|')).join('\r')
  // NOTE the trailing '\r' before ETX — the BS-430 sends (and expects) it, and
  // it is included in the checksum.
  const body = `${frameNum}${text}\r${String.fromCharCode(ETX)}`
  let sum = 0
  for (let k = 0; k < body.length; k++) sum = (sum + body.charCodeAt(k)) & 0xff
  const cs = sum.toString(16).toUpperCase().padStart(2, '0')
  return [Buffer.from(String.fromCharCode(STX) + body + cs + '\r\n', 'latin1')]
}

// ---------------------------------------------------------------------------
// Simulator (build a realistic PR result frame) — exercises parseMindrayAstm
// ---------------------------------------------------------------------------

/** Build a Mindray BS-series ASTM "PR" result message body (text) for a sample. */
export function buildMindrayAstmSample(
  sampleId: string,
  instrumentName: string,
  analytes: DriverAnalyte[]
): string {
  const now = ts()
  const lines: string[] = []
  lines.push(`H|\\^&|||Mindry^^|||||||PR|1394-97|${now}`)
  lines.push(`P|1`)
  const order = analytes.map((an) => `${an.code}^${an.name}^^`).join('\\')
  lines.push(`O|1|1^1^1|${sampleId}|${order}|R|${now}|${now}||||||||serum||||||||||F`)
  analytes.forEach((an, i) => {
    const { value, flag } = simValue(an)
    lines.push(
      `R|${i + 1}|${an.code}^${an.name}^^F|${value}^^^^|${an.unit ?? ''}|^|${flag}||F|${value}^^^^|0|${now}||Mindry^`
    )
  })
  lines.push(`L|1|N`)
  return lines.join('\r')
}
