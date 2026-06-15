import type { IProtocol, ProtocolMessage } from './IProtocol'

/**
 * "Simple protocol" decoder for Landwind LD-series hematology analyzers.
 *
 * The LD-560 (and similar) sends results as plain text lines terminated by a
 * final "END" line. No ASTM framing — no ENQ/STX/ETX/EOT control bytes.
 * The instrument connects as a TCP client; we buffer until we see END.
 *
 * Wire format (comma or tab delimited, auto-detected):
 *   D,<sample_id>,<YYYYMMDD>,<HHMMSS>
 *   WBC,7.5,10^3/uL,N,4.0~11.0
 *   RBC,4.50,10^6/uL,N,4.5~5.9
 *   HGB,14.5,g/dL,N,13.0~17.0
 *   ...
 *   END
 *
 * Some firmware variants prefix the sample line with "SID" instead of "D".
 */
export class SimpleProtocol implements IProtocol {
  readonly kind = 'simple' as const

  private buf = ''

  feed(chunk: Buffer): ProtocolMessage[] {
    this.buf += chunk.toString('utf8')
    const messages: ProtocolMessage[] = []

    // Flush a message each time we see a line that is exactly "END" (case-insensitive).
    const endRe = /^END\r?$/im
    let match: RegExpExecArray | null

    while ((match = endRe.exec(this.buf)) !== null) {
      const block = this.buf.slice(0, match.index + match[0].length)
      this.buf = this.buf.slice(match.index + match[0].length)
      const msg = this.buildMessage(block)
      if (msg.records.length > 0) messages.push(msg)
      // Reset regex index after modifying buf
      endRe.lastIndex = 0
    }

    return messages
  }

  private buildMessage(text: string): ProtocolMessage {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    // Auto-detect delimiter from the first non-empty line.
    const delim = lines[0]?.includes('\t') ? '\t' : ','

    const records = lines.map((line) => line.split(delim).map((f) => f.trim()))

    return { protocol: 'simple', records, raw: text.trim() }
  }

  reset(): void {
    this.buf = ''
  }
}
