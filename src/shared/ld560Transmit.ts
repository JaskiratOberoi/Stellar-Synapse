/**
 * Analytes propagated to Noble LIS: HbA1c (measured) and the Synapse-CALCULATED
 * eAG (ADAG, written in mg/dL). Every other LD-560 analyte — including the
 * instrument's OWN reported eAG, S-A1c, HbA1a/b, HbF, L-A1c, HbA0 — is kept in
 * Synapse for review but never written to the LIS.
 */
export const LD560_LIS_ANALYTES = ['HbA1c', 'eAG'] as const

/**
 * Estimated Average Glucose (mg/dL) from HbA1c %, per the ADAG/Nathan 2008
 * equation eAG = 28.7 × HbA1c − 46.7, rounded to one decimal. Returns null
 * outside the clinically valid 4–20% HbA1c range. Canonical for BOTH the LIS
 * write (main) and the Received-Results display (renderer), so the value the lab
 * sees equals the value posted to Noble.
 */
export function eagMgDlFromHba1c(hba1cPercent: number): number | null {
  if (!Number.isFinite(hba1cPercent) || hba1cPercent < 4 || hba1cPercent > 20) return null
  return Math.round((28.7 * hba1cPercent - 46.7) * 10) / 10
}

/** Convert a glucose value in mg/dL to mmol/L (÷ 18.0182), one decimal. */
export function mgDlToMmolL(mgDl: number): number {
  return Math.round((mgDl / 18.0182) * 10) / 10
}

export type Ld560LisWriteStatus = 'none' | 'partial' | 'done'

/** Whether a stored RAW frame has been written to LIS (HbA1c + eAG). */
export function ld560FrameLisStatus(
  monitor: { instrumentId: string; raw?: string; stage: string; analyteCode: string }[],
  instrumentId: string,
  raw: string
): Ld560LisWriteStatus {
  const rawNorm = normalizeLd560Raw(raw)
  if (!rawNorm) return 'none'
  const written = monitor.filter((m) => {
    if (m.instrumentId !== instrumentId || m.stage !== 'written') return false
    if (normalizeLd560Raw(m.raw) !== rawNorm) return false
    return (LD560_LIS_ANALYTES as readonly string[]).includes(m.analyteCode)
  })
  // Only HbA1c is posted to the LIS, so a frame is fully written once HbA1c is.
  if (written.some((m) => m.analyteCode === 'HbA1c')) return 'done'
  return written.length > 0 ? 'partial' : 'none'
}

/**
 * Chromatogram picture embedded in a frame when the analyzer's picture mode is
 * "Base 64" (base64 body, 76-char lines) or "Bitmap" (same PNG as one ASCII-hex
 * string). "No picture" omits the IMAGE block entirely.
 */
export interface Ld560Image {
  /** File name as reported by the analyzer, e.g. `2026-09-15-01-59_10.png`. */
  name: string
  /** Byte size the analyzer declared in `<SIZE>`. */
  size: number
  /** Encoded payload with whitespace stripped; decode with `encoding`. */
  data: string
  encoding: 'base64' | 'hex'
}

export interface Ld560SampleResult {
  /** Barcode / accession for LIS lookup (vailid). */
  barcode: string
  /** Analyzer internal run number (e.g. 134). */
  internalSeq?: string
  analytes: { code: string; value: string; unit: string }[]
  /**
   * Frame text for the raw view / dedup. When the frame carried a picture, the
   * base64 body is replaced by a short placeholder so the stored raw stays small
   * and byte-identical across re-parses; the picture itself is in `image`.
   */
  raw: string
  image?: Ld560Image
}

const IMAGE_BLOCK_RE = /<IMAGE>([\s\S]*?)<\/IMAGE>/i

/**
 * Pull the `<IMAGE>` block out of a frame. Returns the picture (if any) and the
 * frame text with the base64 body collapsed to `<DATA>[png N bytes]</DATA>`.
 */
export function extractLd560Image(text: string): { image?: Ld560Image; text: string } {
  const m = IMAGE_BLOCK_RE.exec(text)
  if (!m) return { text }
  const body = m[1] ?? ''
  const name = /<NAME>([^<]*)<\/NAME>/i.exec(body)?.[1]?.trim() || 'chromatogram.png'
  const size = Number(/<SIZE>(\d+)<\/SIZE>/i.exec(body)?.[1] ?? 0)
  const data = (/<DATA>([\s\S]*?)<\/DATA>/i.exec(body)?.[1] ?? '').trim()
  // A stored frame already carries the `[png N bytes]` placeholder — no picture to extract.
  if (!data || data.startsWith('[')) return { text }
  const compact = data.replace(/\s+/g, '')
  if (!compact) return { text }
  // Bitmap mode: pure hex, even length, and (for a PNG) the 89 50 4E 47 signature.
  // Base64 mode starts with "iVBORw0KGgo" and contains non-hex letters.
  const isHex = /^[0-9A-Fa-f]+$/.test(compact) && compact.length % 2 === 0
  const encoding: Ld560Image['encoding'] = isHex ? 'hex' : 'base64'
  const payload = isHex ? compact : compact.replace(/[^A-Za-z0-9+/=]/g, '')
  const placeholder = `<IMAGE><NAME>${name}</NAME><SIZE>${size}</SIZE><DATA>[png ${size} bytes]</DATA></IMAGE>`
  return {
    image: { name, size, data: payload, encoding },
    text: text.slice(0, m.index) + placeholder + text.slice(m.index + m[0].length)
  }
}

/**
 * Labnovation LD-560 wire format:
 *   <TRANSMIT><M>…<I>sample|datetime|seq|barcode|pos|flags</I><R>HbA1a|0.3HbA1b|…</R>
 *   [<IMAGE><NAME>file.png</NAME><SIZE>N</SIZE><DATA>base64…</DATA></IMAGE>]</M></TRANSMIT>
 * The IMAGE block is only present when the analyzer's picture mode is "Base 64".
 */
export function parseLd560SampleFromRaw(block: string): Ld560SampleResult | null {
  const decoded = block.replace(/\x02/g, '<').replace(/\x03/g, '>').trim()
  if (!/<TRANSMIT>/i.test(decoded)) return null
  const { image, text } = extractLd560Image(decoded)

  const iMatch = text.match(/<I>([^<]*)/i)
  const rMatch = text.match(/<R>([^<]*)/i)
  if (!rMatch?.[1]) return null

  const infoParts = (iMatch?.[1] ?? '').split('|')
  const internalSeq = infoParts[2]?.trim() || undefined
  const barcodeField = infoParts[3]?.trim() ?? ''
  const barcode = barcodeField || internalSeq || infoParts[0]?.trim() || 'unknown'

  const pairs = parseLd560ResultPairs(rMatch[1])
  if (pairs.length === 0) return null

  return {
    barcode,
    internalSeq: internalSeq && internalSeq !== barcode ? internalSeq : undefined,
    analytes: pairs.map(([code, value]) => ({
      code,
      value,
      unit: unitForAnalyte(code)
    })),
    raw: text,
    ...(image ? { image } : {})
  }
}

/** Normalize raw frame text for deduplication. */
export function normalizeLd560Raw(raw?: string): string | null {
  if (!raw) return null
  const t = raw.trim().replace(/\n$/, '')
  return t.includes('<TRANSMIT>') ? t : null
}

/** Pull complete `<TRANSMIT>…</TRANSMIT>` frame strings from a buffer. */
export function extractLd560TransmitFrameStrings(buf: string): { frames: string[]; rest: string } {
  const frames: string[] = []
  let rest = buf
  const endRe = /<\/TRANSMIT>/i

  while (true) {
    const start = rest.search(/<TRANSMIT>/i)
    if (start < 0) break
    const slice = rest.slice(start)
    const endMatch = endRe.exec(slice)
    if (!endMatch) break
    const endIdx = endMatch.index + endMatch[0].length
    frames.push(slice.slice(0, endIdx))
    rest = rest.slice(start + endIdx)
    endRe.lastIndex = 0
  }

  return { frames, rest }
}

/** Convert parsed sample to Simple-protocol records for the driver pipeline. */
export function ld560SampleToRecords(sample: Ld560SampleResult): string[][] {
  const records: string[][] = [['D', sample.barcode, '', '']]
  if (sample.internalSeq) records[0]!.push(sample.internalSeq)
  for (const a of sample.analytes) {
    records.push([a.code, a.value, a.unit, 'N', ''])
  }
  records.push(['END'])
  return records
}

function unitForAnalyte(code: string): string {
  if (code === 'eAG') return 'mmol/L'
  return '%'
}

const LD560_ANALYTE_CODES = [
  'HbA1a',
  'HbA1b',
  'HbA1c',
  'S-A1c',
  'L-A1c',
  'HbA0',
  'HbF',
  'eAG'
]

function parseLd560ResultPairs(payload: string): [string, string][] {
  const pairs: [string, string][] = []
  let rest = payload.trim()
  while (rest.length > 0) {
    // Match case-insensitively: the analyzer emits some codes with different
    // casing than our canonical list (e.g. "Hbf" vs "HbF"). A case-sensitive
    // match used to break the loop there, dropping every analyte that followed
    // (HbA1c, HbA0, eAG). Always return the canonical code.
    const code = LD560_ANALYTE_CODES.find((c) => rest.toUpperCase().startsWith(c.toUpperCase()))
    if (!code) break
    rest = rest.slice(code.length)
    if (rest.startsWith('|')) rest = rest.slice(1)
    const vm = rest.match(/^([\d.]+)/)
    if (!vm?.[1]) break
    pairs.push([code, vm[1]])
    rest = rest.slice(vm[1].length)
  }
  return pairs
}
