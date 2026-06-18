import { randomUUID } from 'node:crypto'
import type { CanonicalResult } from '../../../shared/types'

export type Ld560FrameKind = 'text-embedded' | 'structured' | 'chromatogram' | 'unknown'

export interface Ld560DecodeResult {
  kind: Ld560FrameKind
  /** Decoded binary length. */
  byteLength: number
  results: CanonicalResult[]
  notes: string[]
  /** First bytes as hex for debugging. */
  headerHex: string
}

/**
 * Attempt to decode an LD-560 ASCII-hex frame into canonical results.
 *
 * Labnovation documents that HbA1c is derived on-instrument from HPLC
 * chromatogram peak integration — the LIS bitmap export is the curve image /
 * trace data, not a pre-computed result table. Without the vendor's binary
 * specification we heuristically scan for embedded text rows and float fields.
 */
export function decodeLd560HexFrame(
  asciiHex: string,
  instrumentId: string
): Ld560DecodeResult {
  const clean = asciiHex.replace(/[\r\n\s]/g, '')
  const notes: string[] = []
  let buf: Buffer

  try {
    buf = Buffer.from(clean, 'hex')
  } catch {
    return empty('unknown', 0, '', ['Invalid hex encoding'], instrumentId)
  }

  const headerHex = [...buf.slice(0, Math.min(16, buf.length))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ')

  // Some firmware interleaves a text Simple block inside binary/hex payloads.
  const embedded = extractEmbeddedSimpleText(buf)
  if (embedded) {
    notes.push('Found embedded Simple-protocol text block inside hex frame.')
    const results = parseSimpleText(embedded, instrumentId)
    if (results.length > 0) {
      return { kind: 'text-embedded', byteLength: buf.length, results, notes, headerHex }
    }
  }

  // Heuristic: fixed header 0x80 ?? 0x8A 0x43 with 16-bit BE length at offset 4.
  if (buf.length >= 8 && buf[0] === 0x80 && buf[2] === 0x8a && buf[3] === 0x43) {
    const declaredLen = buf.readUInt16BE(4)
    notes.push(`Frame header 80 ?? 8A 43; declared payload length ${declaredLen} bytes.`)
    const structured = scanStructuredPayload(buf.slice(6), instrumentId, notes)
    if (structured.length > 0) {
      return { kind: 'structured', byteLength: buf.length, results: structured, notes, headerHex }
    }
  }

  // Scan entire buffer for plausible HbA1c percentage floats (IFCC/NGSP 3–18%).
  const floatHits = scanPercentFloats(buf, instrumentId)
  if (floatHits.length > 0) {
    notes.push(`Recovered ${floatHits.length} plausible percentage float(s) via binary scan.`)
    return { kind: 'structured', byteLength: buf.length, results: floatHits, notes, headerHex }
  }

  notes.push(
    'Payload looks like chromatogram/trace binary — HbA1c is computed on the analyzer via HPLC peak integration, not in this export.'
  )
  notes.push('Disable bitmap picture transfer and use text Simple frames (D,...,END) for numeric results.')

  return { kind: 'chromatogram', byteLength: buf.length, results: [], notes, headerHex }
}

function extractEmbeddedSimpleText(buf: Buffer): string | null {
  const text = buf.toString('latin1')
  if (!/END/i.test(text)) return null
  const start = text.search(/(^|\n|\r)(D|SID),/i)
  if (start < 0) return null
  const end = text.search(/END/i)
  if (end < 0) return null
  return text.slice(start, end + 3)
}

function parseSimpleText(block: string, instrumentId: string): CanonicalResult[] {
  const results: CanonicalResult[] = []
  let sampleId = ''
  const now = new Date().toISOString()
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  for (const line of lines) {
    const rec = line.split(/[,\t]/).map((f) => f.trim())
    const type = (rec[0] || '').toUpperCase()
    if (type === 'D' || type === 'SID') sampleId = rec[1] || ''
    else if (type !== 'END' && rec[1] && !Number.isNaN(parseFloat(rec[1]))) {
      results.push({
        id: randomUUID(),
        instrumentId,
        sampleId,
        analyteCode: rec[0] || '',
        value: rec[1] || '',
        unit: rec[2] || undefined,
        receivedAt: now
      })
    }
  }
  return results
}

/** Scan payload for big/little-endian floats in HbA1c percentage range. */
function scanStructuredPayload(
  payload: Buffer,
  instrumentId: string,
  notes: string[]
): CanonicalResult[] {
  const codes = ['S-A1c', 'HbA1c', 'HbA1a', 'HbA1b', 'HbF', 'HbA0', 'eAG', 'L-A1c']
  const hits: { offset: number; value: number; endian: 'be' | 'le' }[] = []

  for (let i = 0; i <= payload.length - 4; i++) {
    for (const endian of ['be', 'le'] as const) {
      const v = endian === 'be' ? payload.readFloatBE(i) : payload.readFloatLE(i)
      if (v >= 3 && v <= 18 && Math.abs(v - Math.round(v * 10) / 10) < 0.05) {
        hits.push({ offset: i, value: Math.round(v * 10) / 10, endian })
      }
    }
  }

  if (hits.length === 0) return []

  // Deduplicate nearby hits; take up to one per code slot heuristically.
  const unique = dedupeFloatHits(hits)
  notes.push(`Structured scan: ${unique.length} unique float candidate(s).`)

  const now = new Date().toISOString()
  return unique.slice(0, codes.length).map((h, idx) => ({
    id: randomUUID(),
    instrumentId,
    sampleId: '',
    analyteCode: codes[idx] ?? `ANalyte${idx + 1}`,
    value: String(h.value),
    unit: idx === 6 ? 'mmol/L' : '%',
    receivedAt: now
  }))
}

function scanPercentFloats(buf: Buffer, instrumentId: string): CanonicalResult[] {
  return scanStructuredPayload(buf, instrumentId, [])
}

function dedupeFloatHits(
  hits: { offset: number; value: number; endian: 'be' | 'le' }[]
): { offset: number; value: number; endian: 'be' | 'le' }[] {
  const out: typeof hits = []
  for (const h of hits) {
    if (out.some((o) => Math.abs(o.offset - h.offset) <= 2 && Math.abs(o.value - h.value) < 0.15)) continue
    if (out.some((o) => Math.abs(o.value - h.value) < 0.05)) continue
    out.push(h)
  }
  return out.sort((a, b) => a.offset - b.offset)
}

function empty(
  kind: Ld560FrameKind,
  byteLength: number,
  headerHex: string,
  notes: string[],
  _instrumentId: string
): Ld560DecodeResult {
  return { kind, byteLength, results: [], notes, headerHex }
}
