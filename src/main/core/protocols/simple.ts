import type { IProtocol, ProtocolMessage } from './IProtocol'
import { decodeLd560HexFrame } from '../drivers/ld560Binary'
import { extractLd560TransmitFrames } from './ld560Transmit'

/**
 * "Simple protocol" decoder for Landwind / Labnovation LD-series HbA1c analyzers.
 *
 * Wire formats:
 * 1) Labnovation XML-style (no-picture mode):
 *      <TRANSMIT><M>…<I>sample|date|id|…</I><R>HbA1a|0.3HbA1b|0.2…</R></M></TRANSMIT>
 * 2) Legacy comma-delimited text:
 *      D,<sample_id>,<YYYYMMDD>,<HHMMSS>
 *      S-A1c,5.0,%,N,4.0~6.0
 *      END
 *
 * Some firmware builds also push chromatogram bitmaps as long ASCII-hex strings
 * when "bitmap picture transfer" is enabled — those are detected and skipped.
 */
export class SimpleProtocol implements IProtocol {
  readonly kind = 'simple' as const

  private buf = ''

  feed(chunk: Buffer): ProtocolMessage[] {
    // ASCII-hex chromatogram / binary frame from LD-560 (bitmap transfer or binary Simple).
    if (isAsciiHexDump(chunk)) {
      const ascii = chunk.toString('ascii').replace(/[\r\n\s]/g, '')
      const decoded = decodeLd560HexFrame(ascii, 'ld560-frame')
      if (decoded.results.length > 0) {
        const records: string[][] = [['D', '', '', '']]
        for (const r of decoded.results) {
          records.push([r.analyteCode, r.value, r.unit ?? '', 'N', ''])
        }
        records.push(['END'])
        return [
          {
            protocol: 'simple',
            records,
            raw: `[binary decode ${decoded.kind}] ${decoded.notes.join(' ')}`
          }
        ]
      }
      return [
        {
          protocol: 'simple',
          records: [['BITMAP', String(decoded.byteLength), decoded.kind, ...decoded.notes.slice(0, 2)]],
          raw: `[${decoded.kind} frame ${decoded.byteLength}B header=${decoded.headerHex}] ${decoded.notes.join(' ')}`
        }
      ]
    }

    this.buf += chunk.toString('utf8')
    const messages: ProtocolMessage[] = []

    const { messages: transmitMsgs, rest: afterTransmit } = extractLd560TransmitFrames(this.buf)
    messages.push(...transmitMsgs)
    this.buf = afterTransmit

    const endRe = /^END\r?$/im
    let match: RegExpExecArray | null

    while ((match = endRe.exec(this.buf)) !== null) {
      const block = this.buf.slice(0, match.index + match[0].length)
      this.buf = this.buf.slice(match.index + match[0].length)
      const msg = this.buildMessage(block)
      if (msg.records.length > 0) messages.push(msg)
      endRe.lastIndex = 0
    }

    if (this.buf.length > 65536) this.buf = this.buf.slice(-8192)

    return messages
  }

  private buildMessage(text: string): ProtocolMessage {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    const delim = lines[0]?.includes('\t') ? '\t' : ','
    const records = lines.map((line) => line.split(delim).map((f) => f.trim()))

    return { protocol: 'simple', records, raw: text.trim() }
  }

  reset(): void {
    this.buf = ''
  }
}

/** True when the chunk is a long run of ASCII hex digits (bitmap/chromatogram export). */
function isAsciiHexDump(chunk: Buffer): boolean {
  if (chunk.length < 64) return false
  const text = chunk.toString('ascii').replace(/[\r\n\s]/g, '')
  if (text.length < 64) return false
  if (!/^[0-9A-Fa-f]+$/.test(text)) return false
  // Real result text frames are short and contain commas / END.
  if (text.includes(',') || /END/i.test(text)) return false
  return true
}
