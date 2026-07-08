import { randomUUID } from 'node:crypto'
import type { CanonicalResult, ResultFlag } from '../../../shared/types'
import type { ProtocolMessage } from '../protocols/IProtocol'
import type { DriverAnalyte } from './IInstrumentDriver'
import { simValue } from './sampleBuilders'

/** HL7 timestamp YYYYMMDDHHMMSS (Boule "Date/Time Of Message" format). */
function ts(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`
}

/** Un-escape HL7 delimiter escape sequences in a field (e.g. "mg\S\dL" -> "mg^dL"). */
function hl7Unescape(s: string): string {
  return s
    .replace(/\\S\\/g, '^')
    .replace(/\\T\\/g, '&')
    .replace(/\\R\\/g, '~')
    .replace(/\\F\\/g, '|')
    .replace(/\\E\\/g, '\\')
}

/**
 * Map a Boule OBX-8 abnormal flag to a canonical result flag. The BM500 protocol
 * may combine a range flag with a high/low alarm as "H~A" (separated by the HL7
 * repetition character); take the first component.
 */
function normFlag(raw?: string): ResultFlag | undefined {
  if (!raw) return undefined
  const f = raw.split('~')[0].trim().toUpperCase()
  if (['N', 'H', 'L', 'HH', 'LL', 'A'].includes(f)) return f as ResultFlag
  return undefined
}

/**
 * Parse a Boule BM500 HL7 v2.3.1 `ORU^R01` message (Swelab Lumi / Medonic M51),
 * per "Description of LIS Communication Protocol for BM500 Analyzers".
 *
 * The BM500 layout diverges from the generic HL7 parser (drivers/parsing.ts) in
 * ways that matter for correctness:
 *
 *  - The accession **barcode rides in OBR-3** (Filler Order Number) for a result
 *    upload; OBR-2 (Placer) is only populated in a work-order query response.
 *  - Each analyte's OBX-3 is `LOINC^Mnemonic^LN` (e.g. `6690-2^WBC^LN`). The
 *    generic parser keys off OBX-3 component 1 (the opaque LOINC code); we key off
 *    component 2 (the short mnemonic WBC / NEU% / HGB …) so results map cleanly and
 *    match the BOULE_CBC panel. Boule marks research-use items with a leading "*"
 *    (`*ALY#`, `*LIC#`); we strip it so the code is stable.
 *  - Non-result OBX rows are skipped: OBX-2 is only trusted when `NM` (numeric),
 *    which drops the `IS` mode/remark rows and `ED` histogram/scattergram bitmaps;
 *    the `Age` demographic and any Histogram/Scattergram coordinate rows are
 *    dropped by name, and non-numeric values are ignored.
 *
 * MSH-11 (Processing ID) selects the payload: `P` = patient sample / work order,
 * `Q` = QC counting result. Only patient results are surfaced; QC frames are
 * ignored.
 */
export function parseBouleHl7(message: ProtocolMessage, instrumentId: string): CanonicalResult[] {
  const results: CanonicalResult[] = []
  const now = new Date().toISOString()
  let currentSample = ''
  let measuredAt: string | undefined
  let isQc = false

  for (const seg of message.records) {
    const type = (seg[0] || '').toUpperCase()
    if (type === 'MSH') {
      // MSH-11 Processing ID (seg[10]): 'Q' marks a QC counting result frame.
      isQc = (seg[10] || '').trim().toUpperCase() === 'Q'
    } else if (type === 'OBR') {
      // OBR-3 (filler) = sample barcode for a result upload; fall back to OBR-2.
      currentSample = (seg[3] || seg[2] || '').split('^')[0].trim()
      // OBR-7 Observation Date/Time = the counting time.
      measuredAt = seg[7]?.trim() || undefined
    } else if (type === 'OBX') {
      if (isQc) continue // QC counting result, not a patient result
      // Only numeric (NM) parameters are lab results; IS (mode/remark) and ED
      // (histogram/scattergram bitmap) rows are informational.
      if ((seg[2] || '').trim().toUpperCase() !== 'NM') continue
      const idParts = (seg[3] || '').split('^')
      const loinc = (idParts[0] || '').trim()
      // OBX-3 component 2 is the short mnemonic; strip Boule's "*" research marker.
      const name = (idParts[1] || '').trim().replace(/^\*/, '')
      const code = name || loinc
      if (!code) continue
      // Histogram/scattergram line coordinates and the Age demographic are NM but
      // not lab results.
      if (/histogram|scattergram/i.test(name) || code.toLowerCase() === 'age') continue
      const value = (seg[5] || '').trim()
      if (!value || Number.isNaN(Number(value))) continue
      results.push({
        id: randomUUID(),
        instrumentId,
        sampleId: currentSample,
        analyteCode: code,
        analyteName: name || undefined,
        value,
        unit: hl7Unescape((seg[6] || '').trim()) || undefined,
        referenceRange: (seg[7] || '').trim() || undefined,
        flag: normFlag(seg[8]),
        measuredAt,
        receivedAt: now
      })
    }
  }
  return results
}

/**
 * Build a Boule BM500 `ORU^R01` message body (text) for the simulator. Mirrors
 * `parseBouleHl7`: sending app BM500 / facility Boule, barcode in OBR-3, analyte
 * mnemonic in OBX-3 component 2, value/unit/range in OBX-5/6/7, flag in OBX-8.
 */
export function buildBouleHl7Sample(
  sampleId: string,
  _instrumentName: string,
  analytes: DriverAnalyte[]
): string {
  const stamp = ts()
  const seg = (fields: string[]): string => fields.join('|')
  const lines: string[] = []
  lines.push(
    seg(['MSH', '^~\\&', 'BM500', 'Boule', '', '', stamp, '', 'ORU^R01', randomUUID().replace(/-/g, ''), 'P', '2.3.1', '', '', '', '', '', 'UNICODE'])
  )
  lines.push(seg(['PID', '1', '', 'UNKNOWN^^^^MR', '', '^Sample', '', '']))
  // OBR-3 (seg[3]) = sample barcode; OBR-4 counting type; OBR-6/7 sampling/count time.
  lines.push(seg(['OBR', '1', '', sampleId, '00001^Automated Count^99MRC', '', stamp, stamp]))
  analytes.forEach((an, i) => {
    const { value, flag } = simValue(an)
    lines.push(
      seg(['OBX', String(i + 1), 'NM', `^${an.code}^LN`, '', value, an.unit ?? '', an.sim?.ref ?? '', flag, '', '', 'F'])
    )
  })
  return lines.join('\r')
}
