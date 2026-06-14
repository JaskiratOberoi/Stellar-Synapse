import { randomUUID } from 'node:crypto'
import type { CanonicalResult, ResultFlag } from '../../../shared/types'
import type { ProtocolMessage } from '../protocols/IProtocol'

function normFlag(raw?: string): ResultFlag | undefined {
  if (!raw) return undefined
  const f = raw.trim().toUpperCase()
  if (['N', 'H', 'L', 'HH', 'LL', 'A'].includes(f)) return f as ResultFlag
  return undefined
}

/** Extract the analyte code from an ASTM universal test id like "^^^TSH". */
function astmTestId(field?: string): { code: string; name?: string } {
  if (!field) return { code: '' }
  const parts = field.split('^')
  // Universal test ID: ^^^code^name (component 4 = code, 5 = name)
  const code = parts[3] || parts[0] || ''
  const name = parts[4] || undefined
  return { code: code.trim(), name }
}

/** Parse an ASTM E1394 message into canonical results. */
export function parseAstm(message: ProtocolMessage, instrumentId: string): CanonicalResult[] {
  const results: CanonicalResult[] = []
  let currentSample = ''
  const now = new Date().toISOString()

  for (const rec of message.records) {
    const type = (rec[0] || '').toUpperCase()
    if (type === 'O') {
      // O|seq|sampleId|instrSpec|^^^test
      currentSample = (rec[2] || rec[3] || '').trim()
    } else if (type === 'R') {
      const { code, name } = astmTestId(rec[2])
      if (!code) continue
      results.push({
        id: randomUUID(),
        instrumentId,
        sampleId: currentSample,
        analyteCode: code,
        analyteName: name,
        value: (rec[3] || '').trim(),
        unit: (rec[4] || '').trim() || undefined,
        referenceRange: (rec[5] || '').trim() || undefined,
        flag: normFlag(rec[6]),
        measuredAt: rec[12]?.trim() ? rec[12].trim() : undefined,
        receivedAt: now
      })
    }
  }
  return results
}

/** Parse an HL7 v2.x message (MSH/OBR/OBX) into canonical results. */
export function parseHl7(message: ProtocolMessage, instrumentId: string): CanonicalResult[] {
  const results: CanonicalResult[] = []
  let currentSample = ''
  const now = new Date().toISOString()

  for (const seg of message.records) {
    const type = (seg[0] || '').toUpperCase()
    if (type === 'OBR') {
      // OBR|1|placer|filler|... -> use filler/placer as sample id
      currentSample = (seg[3] || seg[2] || '').split('^')[0].trim()
    } else if (type === 'SPM') {
      currentSample = (seg[2] || '').split('^')[0].trim() || currentSample
    } else if (type === 'OBX') {
      // OBX|1|NM|TSH^Thyroid Stim Hormone||2.31|uIU/mL|0.27-4.2|N
      const idParts = (seg[3] || '').split('^')
      const code = (idParts[0] || '').trim()
      const name = idParts[1]?.trim()
      if (!code) continue
      results.push({
        id: randomUUID(),
        instrumentId,
        sampleId: currentSample,
        analyteCode: code,
        analyteName: name,
        value: (seg[5] || '').trim(),
        unit: (seg[6] || '').trim() || undefined,
        referenceRange: (seg[7] || '').trim() || undefined,
        flag: normFlag(seg[8]),
        receivedAt: now
      })
    }
  }
  return results
}
