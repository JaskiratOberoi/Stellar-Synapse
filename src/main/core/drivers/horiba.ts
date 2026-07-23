import { randomUUID } from 'node:crypto'
import type { CanonicalResult, ResultFlag } from '../../../shared/types'
import type { ProtocolMessage } from '../protocols/IProtocol'
import type { DriverAnalyte } from './IInstrumentDriver'
import { simValue } from './sampleBuilders'

/** HL7 timestamp YYYYMMDDHHMMSS. */
function ts(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`
}

/** Un-escape HL7 delimiter escape sequences (e.g. "10\S\9/L" -> "10^9/L"). */
function hl7Unescape(s: string): string {
  return s
    .replace(/\\S\\/g, '^')
    .replace(/\\T\\/g, '&')
    .replace(/\\R\\/g, '~')
    .replace(/\\F\\/g, '|')
    .replace(/\\E\\/g, '\\')
}

function normFlag(raw?: string): ResultFlag | undefined {
  if (!raw) return undefined
  const f = raw.split('~')[0].trim().toUpperCase()
  if (['N', 'H', 'L', 'HH', 'LL', 'A'].includes(f)) return f as ResultFlag
  return undefined
}

/**
 * Parse a HORIBA Yumizen H550 / H550E HL7 v2.5 `OUL^R22` result message
 * (verified against the "Output Format for Host Connection" manual, RAA086BEN).
 *
 * The OUL^R22 layout diverges from the generic HL7 parser (drivers/parsing.ts) in
 * two ways that matter for correctness — this is why the H550E "didn't work" on
 * the generic decoder:
 *
 *  - The accession **barcode rides in SPM-2** (Specimen ID); the OBR carries the
 *    panel name in OBR-4 ("CBC" / "DIF"), not the sample.
 *  - Each analyte's **OBX-3 is `LOINC^Mnemonic^LN`** (e.g. `788-0^RDW-CV^LN`,
 *    `21000-5^RDW-SD^LN`, `82477-1^ESR^LN`). The generic parser keys off OBX-3
 *    component 1 (the opaque LOINC number 788-0), so every result decodes as a
 *    number nobody mapped. We key off component 2 (the short mnemonic RDW-CV /
 *    ESR / WBC …) so results map to the HORIBA_YUMIZEN + HORIBA_ESR panels.
 *
 * Only numeric (OBX-2 = `NM`) rows are lab results; the `ED` rows carry the
 * base64 histogram / scattergram / matrix streams (RBCALONGRES, DIFF, ESR curve),
 * and `ST` rows carry text (dosage category) — both are skipped. The reference
 * range is OBX-7 component 1 ("4.20 - 6.00^REFERENCE_RANGE").
 */
export function parseHoribaHl7(message: ProtocolMessage, instrumentId: string): CanonicalResult[] {
  const results: CanonicalResult[] = []
  const now = new Date().toISOString()
  let currentSample = ''
  let measuredAt: string | undefined

  for (const seg of message.records) {
    const type = (seg[0] || '').toUpperCase()
    if (type === 'SPM') {
      // SPM-2 = Specimen ID (the scanned barcode the LIS order is keyed by).
      currentSample = (seg[2] || '').split('^')[0].trim() || currentSample
    } else if (type === 'OBR') {
      // OBR-7 Observation Date/Time when present; the sample stays from SPM.
      measuredAt = seg[7]?.trim() || measuredAt
    } else if (type === 'OBX') {
      // Only numeric parameters are lab results; ED (histogram/scattergram/matrix
      // base64 streams) and ST (text) rows are informational.
      if ((seg[2] || '').trim().toUpperCase() !== 'NM') continue
      const idParts = (seg[3] || '').split('^')
      // OBX-3 component 2 is the analyzer mnemonic (RDW-CV, ESR, WBC…); fall back
      // to component 1 (LOINC) only if the mnemonic is absent.
      const mnemonic = (idParts[1] || '').trim()
      const code = mnemonic || (idParts[0] || '').trim()
      if (!code) continue
      const value = (seg[5] || '').trim()
      if (!value || Number.isNaN(Number(value))) continue
      results.push({
        id: randomUUID(),
        instrumentId,
        sampleId: currentSample,
        analyteCode: code,
        analyteName: mnemonic || undefined,
        value,
        unit: hl7Unescape((seg[6] || '').trim()) || undefined,
        // OBX-7 = "<low> - <high>^REFERENCE_RANGE"; keep the range component.
        referenceRange: (seg[7] || '').split('^')[0].trim() || undefined,
        flag: normFlag(seg[8]),
        measuredAt,
        receivedAt: now
      })
    }
  }
  return results
}

/**
 * Build a HORIBA Yumizen `OUL^R22` message body (text) for the simulator. Mirrors
 * `parseHoribaHl7`: barcode in SPM-2, analyte mnemonic in OBX-3 component 2, value
 * in OBX-5, only NM rows.
 */
export function buildHoribaHl7Sample(
  sampleId: string,
  instrumentName: string,
  analytes: DriverAnalyte[]
): string {
  const stamp = ts()
  const seg = (fields: string[]): string => fields.join('|')
  const lines: string[] = []
  lines.push(
    seg(['MSH', '^~\\&', `${instrumentName}^SIM^1.0`, 'HORIBA_MEDICAL', 'Application', 'Facility', stamp, '', 'OUL^R22^OUL_R22', stamp, 'P', '2.5', '', '', '', '', '', 'UNICODE UTF-8'])
  )
  lines.push(seg(['SPM', '1', sampleId, '', 'WB', '', '', '', '', 'P', '', '', '', '', '', stamp, stamp]))
  lines.push(seg(['OBR', '1', '', '', 'CBC', '', '', stamp]))
  analytes.forEach((a, i) => {
    const { value, flag } = simValue(a)
    // OBX-3 = ^<mnemonic>^LN (blank LOINC), value OBX-5, unit OBX-6, range OBX-7.
    lines.push(
      seg(['OBX', String(i + 1), 'NM', `^${a.code}^LN`, '', value, a.unit ?? '', a.sim?.ref ?? '', flag, '', '', 'F', '', '', stamp])
    )
  })
  return lines.join('\r')
}
