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
  const parts = field.split('^').map((p) => p.trim())
  // Standard ASTM universal test ID is "^^^code^name" — three empty leading
  // components, code in component 4 (Maglumi, Beckman, generic-astm, …).
  if (parts[0] === '' && parts[1] === '' && parts[2] === '') {
    return { code: parts[3] || '', name: parts[4] || undefined }
  }
  // Non-standard layout where the test rides in the leading components, e.g. the
  // Agappe Mispa Maestro R record "assayNo^assayName^^resultType" -> "1^HbA1c^^S".
  // Take the first non-numeric token as the analyte name/code.
  const code = parts.find((p) => p && !/^\d+$/.test(p)) || parts[0] || ''
  return { code, name: code || undefined }
}

/**
 * Detect an ASTM Query (Q) record and extract the queried sample barcode (SID).
 * Maglumi sends `Q|1|^SID||ALL|...` when a sample is loaded and "Auto Download
 * Test Assay" (host query) is on. The SID rides in field 3 (index 2) as the
 * starting-range id, typically `^SID` or `patientId^SID^...`; we take the first
 * non-empty caret component.
 */
export function extractAstmQuery(message: ProtocolMessage): { sid: string } | null {
  if (message.protocol !== 'astm') return null
  for (const rec of message.records) {
    if ((rec[0] || '').toUpperCase() !== 'Q') continue
    const field = rec[2] || rec[3] || ''
    const sid = field
      .split('^')
      .map((p) => p.trim())
      .find((p) => p.length > 0)
    if (sid) return { sid }
  }
  return null
}

/** Parse an ASTM E1394 message into canonical results. */
export function parseAstm(message: ProtocolMessage, instrumentId: string): CanonicalResult[] {
  const results: CanonicalResult[] = []
  let currentSample = ''
  const now = new Date().toISOString()

  for (const rec of message.records) {
    const type = (rec[0] || '').toUpperCase()
    if (type === 'O') {
      // O|seq|sampleId|instrSpec|^^^test. The sample id may carry rack/position
      // subcomponents (e.g. Mispa Maestro "sampleId^rack^pos"), so keep only the
      // first component as the accession barcode.
      currentSample = (rec[2] || rec[3] || '').split('^')[0].trim()
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

/**
 * Parse a "Simple protocol" message from Landwind LD-series hematology analyzers.
 *
 * Records layout (comma or tab delimited, auto-detected by SimpleProtocol):
 *   rec[0] — type: "D"/"SID" (sample header), analyte code (WBC/RBC/…), or "END"
 *   rec[1] — sample id (header) OR numeric value (result)
 *   rec[2] — unit
 *   rec[3] — flag  (N, H, L, HH, LL, A)
 *   rec[4] — reference range
 */
export function parseSimple(message: ProtocolMessage, instrumentId: string): CanonicalResult[] {
  const results: CanonicalResult[] = []
  let sampleId = ''
  const now = new Date().toISOString()

  for (const rec of message.records) {
    const type = (rec[0] || '').trim().toUpperCase()

    if (type === 'D' || type === 'SID' || type === 'SAMPLE') {
      sampleId = (rec[1] || '').trim()
    } else if (type === 'BITMAP') {
      // Chromatogram image data — not a lab result row.
      continue
    } else if (type !== 'END' && type !== '') {
      const value = (rec[1] || '').trim()
      if (!value || isNaN(parseFloat(value))) continue
      results.push({
        id: randomUUID(),
        instrumentId,
        sampleId,
        analyteCode: type,
        value,
        unit: (rec[2] || '').trim() || undefined,
        flag: normFlag(rec[3]),
        referenceRange: (rec[4] || '').trim() || undefined,
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
