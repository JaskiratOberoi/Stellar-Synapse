import { randomUUID } from 'node:crypto'
import type { CanonicalResult, ResultFlag } from '../../../shared/types'
import type { ProtocolMessage } from '../protocols/IProtocol'
import {
  type AuFormat,
  DEFAULT_AU_FORMAT,
  auGroupWidth,
  auHeaderWidth,
  parseAuHeader
} from '../protocols/beckmanAu'
import type { DriverAnalyte } from './IInstrumentDriver'
import { simValue } from './sampleBuilders'

/**
 * Beckman Coulter AU "Online" test menu and fixed-field result parsing.
 *
 * The AU analyzers identify each assay by a 2-digit "Online Test No." configured
 * on the analyzer's `[Online] > Online Test No.` screen — the wire never carries
 * the mnemonic, only the number. `AU_ONLINE_TESTS` mirrors a real AU480's
 * configured menu (the default Beckman ordering); it is the single source of
 * truth for both the driver's analyte panel and the number<->code map used to
 * decode results. Sites that renumber tests can override this map later.
 */

interface AuTest {
  no: number
  code: string
  name: string
  unit: string
  min: number
  max: number
  decimals?: number
}

/** Default AU480 online test menu (matches the AU480 `Online Test No.` table). */
export const AU_ONLINE_TESTS: AuTest[] = [
  { no: 1, code: 'GLU', name: 'Glucose', unit: 'mg/dL', min: 70, max: 100, decimals: 0 },
  { no: 2, code: 'UREA', name: 'Urea (BUN)', unit: 'mg/dL', min: 15, max: 40, decimals: 0 },
  { no: 3, code: 'UA', name: 'Uric Acid', unit: 'mg/dL', min: 3.5, max: 7.2, decimals: 1 },
  { no: 4, code: 'TP', name: 'Total Protein', unit: 'g/dL', min: 6.4, max: 8.3, decimals: 1 },
  { no: 5, code: 'CREAT', name: 'Creatinine', unit: 'mg/dL', min: 0.7, max: 1.3, decimals: 2 },
  { no: 6, code: 'DBILC', name: 'Direct Bilirubin (DCA)', unit: 'mg/dL', min: 0, max: 0.3, decimals: 2 },
  { no: 7, code: 'DBILB', name: 'Direct Bilirubin (BuBc)', unit: 'mg/dL', min: 0, max: 0.3, decimals: 2 },
  { no: 8, code: 'TBILC', name: 'Total Bilirubin (DCA)', unit: 'mg/dL', min: 0.3, max: 1.2, decimals: 2 },
  { no: 9, code: 'TBILB', name: 'Total Bilirubin (BuBc)', unit: 'mg/dL', min: 0.3, max: 1.2, decimals: 2 },
  { no: 10, code: 'ALB', name: 'Albumin', unit: 'g/dL', min: 3.5, max: 5.2, decimals: 1 },
  { no: 11, code: 'CHOL', name: 'Total Cholesterol', unit: 'mg/dL', min: 125, max: 200, decimals: 0 },
  { no: 12, code: 'HDL-C', name: 'HDL Cholesterol', unit: 'mg/dL', min: 40, max: 60, decimals: 0 },
  { no: 13, code: 'TRIG', name: 'Triglycerides', unit: 'mg/dL', min: 50, max: 150, decimals: 0 },
  { no: 14, code: 'LDL-C', name: 'LDL Cholesterol', unit: 'mg/dL', min: 50, max: 130, decimals: 0 },
  { no: 15, code: 'ALP', name: 'Alkaline Phosphatase', unit: 'U/L', min: 44, max: 147, decimals: 0 },
  { no: 16, code: 'ALT', name: 'Alanine Aminotransferase', unit: 'U/L', min: 7, max: 56, decimals: 0 },
  { no: 17, code: 'AST', name: 'Aspartate Aminotransferase', unit: 'U/L', min: 5, max: 40, decimals: 0 },
  { no: 18, code: 'GGT', name: 'Gamma GT', unit: 'U/L', min: 8, max: 61, decimals: 0 },
  { no: 19, code: 'AMY', name: 'Amylase', unit: 'U/L', min: 28, max: 100, decimals: 0 },
  { no: 20, code: 'CALA', name: 'Calcium', unit: 'mg/dL', min: 8.6, max: 10.2, decimals: 1 },
  { no: 21, code: 'LIPASE', name: 'Lipase', unit: 'U/L', min: 13, max: 60, decimals: 0 },
  { no: 22, code: 'AMY06', name: 'Amylase (Pancreatic)', unit: 'U/L', min: 13, max: 53, decimals: 0 },
  { no: 23, code: 'PHOS', name: 'Phosphorus', unit: 'mg/dL', min: 2.5, max: 4.5, decimals: 1 },
  { no: 24, code: 'IRON', name: 'Iron', unit: 'ug/dL', min: 60, max: 170, decimals: 0 },
  { no: 25, code: 'UIBC', name: 'Unsaturated Iron Binding Capacity', unit: 'ug/dL', min: 150, max: 375, decimals: 0 },
  { no: 26, code: 'RF', name: 'Rheumatoid Factor', unit: 'IU/mL', min: 0, max: 14, decimals: 0 },
  { no: 27, code: 'CRPN', name: 'C-Reactive Protein', unit: 'mg/L', min: 0, max: 5, decimals: 1 },
  { no: 28, code: 'CRPHS', name: 'C-Reactive Protein (hs)', unit: 'mg/L', min: 0, max: 3, decimals: 1 },
  { no: 96, code: 'LIH', name: 'Serum Index (Lipemia/Icterus/Hemolysis)', unit: '', min: 0, max: 1, decimals: 0 },
  { no: 97, code: 'Na', name: 'Sodium', unit: 'mmol/L', min: 135, max: 145, decimals: 0 },
  { no: 98, code: 'K', name: 'Potassium', unit: 'mmol/L', min: 3.5, max: 5.1, decimals: 1 },
  { no: 99, code: 'Cl', name: 'Chloride', unit: 'mmol/L', min: 98, max: 107, decimals: 0 }
]

/** Online test number -> assay. */
const AU_TEST_BY_NO = new Map<number, AuTest>(AU_ONLINE_TESTS.map((t) => [t.no, t]))
/** Instrument code -> online test number (for the simulator / order building). */
export const AU_NO_BY_CODE = new Map<string, number>(
  AU_ONLINE_TESTS.map((t) => [t.code.toUpperCase(), t.no])
)

/** Resolve an instrument analyte code to its configured Online Test No. (or null). */
export function auOnlineTestNo(code: string): number | null {
  return AU_NO_BY_CODE.get(code.trim().toUpperCase()) ?? null
}

/**
 * Some AU "Online" channels measure ONE analyte that the LIS catalogs as several
 * ordering VARIANTS — e.g. a single Glucose channel vs. LIS "Glucose - Fasting /
 * Post Prandial / Random", or one RF channel vs. several RA-factor methods. The
 * analyzer reports a single value; whichever variant the doctor ordered for the
 * sample is the one to query and fill. A fixed 1:1 mapping therefore misses the
 * order whenever a different variant was chosen.
 *
 * Each group matches its variants by (case-insensitive) LIS test name so both
 * host-query reverse-mapping and result-writing can resolve to the actually
 * ordered variant instead of the single hard-coded test on the mapping rule.
 * Matching is deliberately conservative (anchored to the analyte, excluding
 * unrelated panels) so it never bleeds into a different test.
 */
export interface AuVariantGroup {
  /** AU analyte/online code this group applies to (e.g. 'GLU', 'RF'). */
  code: string
  /** True when a LIS test name is one of this channel's orderable variants. */
  matches: (lisTestName: string) => boolean
}

export const AU_VARIANT_GROUPS: AuVariantGroup[] = [
  {
    code: 'GLU',
    // Point glucose measurements only (Fasting / Post Prandial / Random and the
    // bare serum/plasma glucose). Exclude tolerance & challenge panels, G6PD,
    // urine glucose, and timed GTT samples — those are separate workflows the AU
    // glucose channel must not silently satisfy.
    matches: (name): boolean => {
      const n = name.toLowerCase()
      if (/tolerance|challenge|g6pd|gtt|gct|urine|\d\s*hr|hr\)/.test(n)) return false
      return /\bglucose\b/.test(n)
    }
  },
  {
    code: 'RF',
    // Any rheumatoid-factor method variant (Nephelometry / IgM / IgG / Latex):
    // the AU RF channel reports one quantitative value for whichever was ordered.
    matches: (name): boolean => /rheumatoid arthritis factor|\bra factor\b/i.test(name)
  }
]

const AU_VARIANT_BY_CODE = new Map<string, AuVariantGroup>(
  AU_VARIANT_GROUPS.map((g) => [g.code.toUpperCase(), g])
)

/** Variant group for an instrument analyte code, if that channel has one. */
export function auVariantGroup(code: string): AuVariantGroup | undefined {
  return AU_VARIANT_BY_CODE.get(code.trim().toUpperCase())
}

/** Driver analyte panel for the Beckman AU family (full configured menu). */
export const BECKMAN_AU: DriverAnalyte[] = AU_ONLINE_TESTS.map((t) => ({
  code: t.code,
  name: t.name,
  unit: t.unit || undefined,
  sim: { min: t.min, max: t.max, decimals: t.decimals ?? 2, ref: `${t.min} to ${t.max}` }
}))

/** Map an AU 2-char data-mark field to a canonical result flag. */
function auFlag(marks: string): ResultFlag | undefined {
  const m = marks.toUpperCase()
  if (m.includes('H') || m.includes('>') || m.includes('+')) return 'H'
  if (m.includes('L') || m.includes('<')) return 'L'
  if (m.includes('A') || m.includes('!') || m.includes('*')) return 'A'
  return undefined
}

/**
 * Parse a Beckman AU "Online" result message into canonical results. The decoder
 * (protocols/beckmanAu.ts) has already framed the block, learned the barcode
 * from the matching S… message, and put `[distinction, sampleId]` in records[0];
 * the fixed-width result groups are sliced from `raw` here.
 */
export function parseBeckmanAu(
  message: ProtocolMessage,
  instrumentId: string,
  fmt: AuFormat = DEFAULT_AU_FORMAT
): CanonicalResult[] {
  const distinction = message.records[0]?.[0] ?? ''
  // Only result-data messages carry analyte values; ignore R…/S…/DB/DE markers.
  if (distinction[0] !== 'D' && distinction[0] !== 'd') return []

  const sampleId = message.records[0]?.[1] ?? ''
  const block = message.raw
  const groupWidth = auGroupWidth(fmt)
  const now = new Date().toISOString()
  const results: CanonicalResult[] = []

  // Iterate the repeating result groups. A truncated final group (the analyzer's
  // zero-suppress can drop trailing pad spaces) is padded back to full width.
  for (let off = auHeaderWidth(fmt); off + fmt.testNo <= block.length; off += groupWidth) {
    const group = block.slice(off, off + groupWidth).padEnd(groupWidth, ' ')
    let i = 0
    const take = (n: number): string => {
      const s = group.slice(i, i + n)
      i += n
      return s
    }
    const testNo = parseInt(take(fmt.testNo), 10)
    take(fmt.diluent) // diluent type — not surfaced
    const rawValue = take(fmt.result).trim()
    const marks = take(fmt.marks)

    if (!Number.isFinite(testNo) || testNo <= 0) break // padding / end of groups
    const test = AU_TEST_BY_NO.get(testNo)
    if (!test) continue // configured on the analyzer but unknown to us — skip
    if (!rawValue || Number.isNaN(parseFloat(rawValue))) continue // masked / no result

    results.push({
      id: randomUUID(),
      instrumentId,
      sampleId,
      analyteCode: test.code,
      analyteName: test.name,
      value: rawValue,
      unit: test.unit || undefined,
      flag: auFlag(marks),
      receivedAt: now
    })
  }

  return results
}

/** Right-justify a value into the fixed AU result field (space-padded). */
function auResultField(value: string, width: number): string {
  return value.length >= width ? value.slice(-width) : value.padStart(width, ' ')
}

const auMarks = (flag: string, width: number): string =>
  (flag === 'H' ? 'H ' : flag === 'L' ? 'L ' : flag === 'A' ? 'A ' : '  ').slice(0, width)

const padField = (s: string, n: number): string => s.padEnd(n, ' ').slice(0, n)

/** Build the fixed per-sample header (shared by S… and D… outbound frames). */
function auHeader(
  distinction: string,
  rack: string,
  cup: string,
  sampleNo: string,
  sampleId: string,
  fmt: AuFormat
): string {
  return (
    distinction +
    padField('', fmt.systemNo) +
    padField(rack, fmt.rack) +
    padField(cup, fmt.cup) +
    padField(sampleNo, fmt.sampleNo) +
    padField('', fmt.sampleType) +
    padField(sampleId, fmt.sampleId) +
    padField('', fmt.dummy) +
    padField('0', fmt.dataClass) +
    padField('', fmt.sex)
  )
}

/**
 * Build the Sample-Information RESPONSE (S∆) that answers a sample-information
 * request — replicated BYTE-FOR-BYTE from the live, working ElabAssistLite AU480
 * interface (Genomic Labs, 2026-06, logINMessage / logDetails).
 *
 * Worked example (request → response) captured on the live host link:
 *
 *   R 000301N0007             9064234
 *   S 000301 0007             9064234    EM00000KAMLESH             099012011005018097010004013002003015098016017006008020
 *
 * Decode of the response:
 *   "S " + <31-char identity: rack(4) cup(2) type(1) sampleNo(4) … barcode> +
 *   "    "(4) + "E" + "M00000" + <patient name, 20 chars> + <3-digit Online Test Nos…>
 *
 * Two rules make it work, and both are intentionally NOT "smart":
 *  - The 31-char demographics region ("    " + "E" + "M00000" + name(20)) MUST be
 *    present. It is fixed-width padding that places the first Online Test No. at
 *    byte offset 64 — exactly where the analyzer (and our own result parser)
 *    expects it. Omitting the name field shifts every test number and the AU
 *    misreads / rejects the order.
 *  - The identity region (rack..barcode) is echoed from the request verbatim so
 *    it matches exactly (alarm 6042 "ONLINE MISMATCH" otherwise), EXCEPT the
 *    1-char sample-type flag, which the live interface always blanks to a space
 *    in its S responses (the request may carry "N").
 *
 * @param requestBlock the raw R∆ request block (no STX/ETX), e.g. "R 000301N0007…"
 * @param testNos       the ordered Online Test Numbers, in DB order
 * @param opts.patientName the LIS patient name (≤20 chars shown; blank-padded if absent)
 */
export function buildAuOrderResponse(
  requestBlock: string,
  testNos: number[],
  fmt: AuFormat = DEFAULT_AU_FORMAT,
  opts: { patientName?: string } = {}
): string {
  // 31-char identity region (rack..barcode), echoed verbatim from the request.
  let id = requestBlock.slice(2)
  // Blank the sample-type flag (rack(4) + cup(2) = index 6 within `id`) — the
  // live interface always sends a space here in its S responses.
  if (id.length > 6) id = id.slice(0, 6) + ' ' + id.slice(7)

  // Fixed 31-char demographics block: 4 spaces + block flag "E" + "M00000" + name(20).
  const demographics = ' '.repeat(4) + 'E' + 'M00000' + padField(opts.patientName ?? '', 20)

  let block = 'S ' + id + demographics
  for (const no of testNos) {
    block += String(no).padStart(fmt.testNo, '0') // Online Test No. (3 digits)
  }
  return block
}

/**
 * Build a Beckman AU "Online" transmission (text, one block per line) for the
 * simulator: an S… sample-information block carrying the barcode followed by a
 * D… result block keyed by the same rack/cup. Shares the format with the parser
 * so the frame round-trips through the decoder.
 */
export function buildBeckmanAuSample(
  sampleId: string,
  analytes: DriverAnalyte[],
  fmt: AuFormat = DEFAULT_AU_FORMAT
): string {
  const rack = '0001'
  const cup = '01'
  const digits = sampleId.replace(/\D/g, '')
  const sampleNo = (digits.slice(-4) || '0001').padStart(fmt.sampleNo, '0')

  // S∆ sample-information block carrying the barcode.
  const sBlock = auHeader('S ', rack, cup, sampleNo, sampleId, fmt)

  // D∆ result block: header + repeating [testNo, diluent, result, marks].
  let dBlock = auHeader('D ', rack, cup, sampleNo, sampleId, fmt)
  for (const a of analytes) {
    const no = AU_NO_BY_CODE.get(a.code.toUpperCase())
    if (no === undefined) continue
    const { value, flag } = simValue(a)
    dBlock +=
      String(no).padStart(fmt.testNo, '0') +
      padField('0', fmt.diluent) +
      auResultField(value, fmt.result) +
      auMarks(flag, fmt.marks)
  }

  return `${sBlock}\n${dBlock}`
}
