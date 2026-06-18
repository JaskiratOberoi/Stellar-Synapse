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

/** Un-escape HL7 delimiter escape sequences in a field (e.g. "10\S\9/L" -> "10^9/L"). */
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
 * Parse an EDAN H60 / H60 Vet HL7 v2.4 `ORU^R01` message (verified against a
 * captured H60 frame). The H60 diverges from the generic HL7 layout:
 *
 *  - **OBX-3 is a constant `0`**; the analyte mnemonic (WBC, NEU#, RDW_CV, …)
 *    lives in **OBX-4** (Observation Sub-ID). The generic parser keys off OBX-3
 *    and so decodes every result as analyte "0".
 *  - The **sample id is OBR-2** (Placer); OBR-3 is blank.
 *  - Units are HL7-escaped: `10\S\9/L` -> `10^9/L`.
 *  - The result flag (L/H/…) is in **OBX-13**, not OBX-8.
 *  - Masked / no-data cells carry `---` (not measured) or `***` (suppressed) as
 *    the value; these are skipped (only numeric results are surfaced).
 */
export function parseEdanHl7(message: ProtocolMessage, instrumentId: string): CanonicalResult[] {
  const results: CanonicalResult[] = []
  const now = new Date().toISOString()
  let sid = ''
  let measuredAt: string | undefined

  for (const seg of message.records) {
    const type = (seg[0] || '').toUpperCase()
    if (type === 'OBR') {
      // OBR-2 (placer) = sample id; OBR-3 is blank. OBR-7 = analysis date/time.
      sid = (seg[2] || seg[3] || '').split('^')[0].trim()
      measuredAt = seg[7]?.trim() || undefined
    } else if (type === 'OBX') {
      const code = (seg[4] || '').split('^')[0].trim() // analyte mnemonic (OBX-4)
      if (!code || code === '0') continue
      const value = (seg[5] || '').trim()
      // Skip masked ("***") / no-data ("---") / non-numeric cells.
      if (!value || Number.isNaN(Number(value))) continue
      results.push({
        id: randomUUID(),
        instrumentId,
        sampleId: sid,
        analyteCode: code,
        analyteName: code,
        value,
        unit: hl7Unescape((seg[6] || '').trim()) || undefined,
        referenceRange: (seg[7] || '').trim() || undefined,
        flag: normFlag(seg[13]),
        measuredAt,
        receivedAt: now
      })
    }
  }
  return results
}

/**
 * Build an EDAN H60-style `ORU^R01` body (text) for the simulator. Mirrors
 * `parseEdanHl7`: analyte mnemonic in OBX-4 (OBX-3 fixed "0"), escaped unit,
 * flag in OBX-13.
 */
export function buildEdanHl7Sample(
  sampleId: string,
  _instrumentName: string,
  analytes: DriverAnalyte[]
): string {
  const stamp = ts()
  const seg = (fields: string[]): string => fields.join('|')
  const escUnit = (u?: string): string => (u ?? '').replace(/\^/g, '\\S\\')

  const lines: string[] = []
  lines.push(seg(['MSH', '^~\\&', 'H60^4131', 'EDANLAB', '', '', stamp, '', 'ORU^R01', '1', 'P', '2.4', '', '', '', '0', '', 'UTF8']))
  lines.push(seg(['PID', '1', '', `${sampleId}^0`, '', '', '', '0']))
  lines.push(seg(['OBR', '', sampleId, '', 'EDANLAB^H60^Sample', '0', 'General', stamp]))
  for (const a of analytes) {
    const { value, flag } = simValue(a)
    lines.push(
      seg(['OBX', '', 'NM', '0', a.code, value, escUnit(a.unit), a.sim?.ref ?? '', '0', '', '0', '', `${value}^${escUnit(a.unit)}`, flag])
    )
  }
  return lines.join('\r')
}
