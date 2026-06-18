import { randomUUID } from 'node:crypto'
import type { CanonicalResult, ResultFlag } from '../../../shared/types'
import type { ProtocolMessage } from '../protocols/IProtocol'
import type { DriverAnalyte } from './IInstrumentDriver'
import { simValue } from './sampleBuilders'

/** HL7 timestamp YYYYMMDDHHMMSS (Metis date/time format). */
function ts(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`
}

/** Map a Metis OBX-8 abnormal flag to a canonical result flag. */
function normFlag(raw?: string): ResultFlag | undefined {
  if (!raw) return undefined
  // OBX-8 may carry repetitions like "L~A" — take the first component.
  const f = raw.split('~')[0].trim().toUpperCase()
  if (['N', 'H', 'L', 'HH', 'LL', 'A'].includes(f)) return f as ResultFlag
  return undefined
}

/**
 * Parse a Getein Metis-series HL7 v2.3.1 `ORU^R01` message (MSH/PID/OBR/OBX).
 *
 * Metis diverges from the generic HL7 layout (drivers/parsing.ts `parseHl7`) in
 * two ways that matter for correctness, per the "HL7 Communication Protocol –
 * Metis Series" spec:
 *
 *  - The accession **barcode rides in OBR-2** (Placer Order Number); OBR-3
 *    (Filler) is the analyzer's internal *sample number*, not the barcode. The
 *    generic parser prefers OBR-3, which would key results to the wrong id.
 *  - The analyte is identified by **OBX-3** (Observation Identifier = the item
 *    ID that "must be the same on the LIS and the equipment"), with the friendly
 *    name in **OBX-4** (Observation Sub-ID). Map instrument codes to these IDs.
 *
 * `MSH-16` selects the payload: 0 = patient sample, 1 = calibration, 2 = QC.
 * Only patient results are surfaced; calibration/QC frames are ignored.
 */
export function parseGeteinHl7(message: ProtocolMessage, instrumentId: string): CanonicalResult[] {
  const results: CanonicalResult[] = []
  const now = new Date().toISOString()
  let currentSample = ''
  let resultClass = '0' // MSH-16: 0=patient, 1=cal, 2=QC

  for (const seg of message.records) {
    const type = (seg[0] || '').toUpperCase()
    if (type === 'MSH') {
      // MSH-16 carries the payload class (0/1/2). The Metis spec table numbers it
      // as field 16 (seg[15]), but the manual's own worked examples place the
      // token one field later (seg[16], with seg[15] blank). Accept either so a
      // calibration/QC frame is recognized under both interpretations.
      const cls = [seg[15], seg[16]]
        .map((s) => (s || '').trim())
        .find((s) => s === '1' || s === '2')
      resultClass = cls ?? '0'
    } else if (type === 'OBR') {
      // OBR-2 (placer) = sample barcode; fall back to OBR-3 (filler/sample no).
      currentSample = (seg[2] || seg[3] || '').split('^')[0].trim()
    } else if (type === 'OBX') {
      if (resultClass === '1' || resultClass === '2') continue // cal/QC, not a patient result
      const code = (seg[3] || '').split('^')[0].trim()
      if (!code) continue
      const name = (seg[4] || '').split('^')[0].trim() || undefined
      const ref = (seg[7] || '').trim()
      results.push({
        id: randomUUID(),
        instrumentId,
        sampleId: currentSample,
        analyteCode: code,
        analyteName: name,
        value: (seg[5] || '').trim(),
        unit: (seg[6] || '').trim() || undefined,
        // A bare "-" is Metis' placeholder for "no reference range".
        referenceRange: ref && ref !== '-' ? ref : undefined,
        flag: normFlag(seg[8]),
        measuredAt: seg[14]?.trim() || undefined, // OBX-14 Date/Time of the Observation
        receivedAt: now
      })
    }
  }
  return results
}

/**
 * Build a Getein Metis `ORU^R01` message body (text) for the simulator. Mirrors
 * `parseGeteinHl7`: barcode in OBR-2, analyte id in OBX-3, name in OBX-4,
 * MSH-16 = 0 (patient sample).
 */
export function buildGeteinHl7Sample(
  sampleId: string,
  instrumentName: string,
  analytes: DriverAnalyte[]
): string {
  const stamp = ts()
  const sampleNo = (sampleId.replace(/\D/g, '').slice(-4) || '0001').padStart(4, '0')

  const seg = (fields: string[]): string => fields.join('|')
  const lines: string[] = []
  // Mirror the manual's worked example layout: class token '0' (patient) at the
  // seg[16] position, UTF8 char set at seg[18].
  lines.push(
    seg(['MSH', '^~\\&', 'GP', instrumentName, '', '', stamp, '', 'ORU^R01', sampleNo, 'P', '2.3.1', '', '', '', '', '0', '', 'UTF8'])
  )
  lines.push(seg(['PID', '1', '', sampleId, '', '', '', 'U']))
  // OBR-2 (seg[2]) = barcode; OBR-3 (seg[3]) = internal sample number.
  lines.push(seg(['OBR', '1', sampleId, sampleNo, `^${instrumentName}`, 'N', '', stamp]))
  analytes.forEach((a, i) => {
    const { value, flag } = simValue(a)
    lines.push(
      seg([
        'OBX',
        String(i + 1),
        'NM',
        a.code, // OBX-3 item id
        a.name, // OBX-4 item name
        value,
        a.unit ?? '',
        a.sim?.ref ?? '',
        flag,
        '',
        '',
        'F',
        '',
        '',
        stamp // OBX-14 observation time
      ])
    )
  })
  return lines.join('\r')
}
