import type { IProtocol, ProtocolMessage } from './IProtocol'

// ASTM E1381 low-level control characters.
const STX = 0x02
const ETX = 0x03
const EOT = 0x04
const ENQ = 0x05
const ACK = 0x06
const LF = 0x0a
const CR = 0x0d
const ETB = 0x17

/**
 * ASTM E1381 (low-level framing) + E1394 (record content) decoder.
 *
 * E1381 framing: the analyzer announces with <ENQ>, then sends frames
 *   <STX> FN text <ETB|ETX> C1 C2 <CR> <LF>
 * and ends the session with <EOT>. The middleware ACKs each frame.
 *
 * E1394 records are pipe-delimited rows, e.g.
 *   H|\^&|||Maglumi X3|...
 *   P|1||PID||Doe^John
 *   O|1|SAMPLE123||^^^TSH
 *   R|1|^^^TSH|2.31|uIU/mL|0.27 to 4.2|N
 *   L|1|N
 *
 * This implementation accumulates frame text, separating records at each
 * frame's ETX (or an inter-record CR), and flushes a complete message on <EOT>
 * or as soon as an L (terminator) record arrives. The terminator-flush supports
 * analyzers that omit the E1381 <EOT> envelope (Agappe Mispa Maestro /
 * BioHermes BH60: bare <STX>FN data<ETX> frames, no CR/checksum/EOT). Checksum
 * verification and full retransmit handling are marked for the hardening phase.
 */
export class AstmProtocol implements IProtocol {
  readonly kind = 'astm'
  private textBuffer = ''
  /** Callback used by the orchestrator to push low-level ACKs back. */
  onControl?: (byte: number) => void

  feed(chunk: Buffer): ProtocolMessage[] {
    const messages: ProtocolMessage[] = []

    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]
      switch (byte) {
        case ENQ:
          // Analyzer requests to send. Reply ACK (handled by orchestrator).
          this.onControl?.(ACK)
          this.textBuffer = ''
          break
        case STX:
          // Start of a frame; the next char is the frame number, stripped in
          // buildMessage. Record separation happens at the frame's ETX below.
          break
        case ETB:
          // Intermediate frame of a multi-frame record: ACK and keep
          // accumulating — the record continues in the next frame.
          this.onControl?.(ACK)
          break
        case ETX:
          // End of a record's final frame. ACK, then terminate the record so
          // each frame becomes its own E1394 row even when the analyzer omits
          // the inter-record CR — the Agappe Mispa Maestro / BioHermes BH60 send
          // <STX>FN data<ETX> with no CR, no checksum and no closing <EOT>.
          this.onControl?.(ACK)
          if (this.textBuffer.length > 0 && !this.textBuffer.endsWith('\n')) {
            this.textBuffer += '\n'
          }
          // Those analyzers mark end-of-message with the L (terminator) record
          // rather than <EOT>, so flush as soon as a terminator frame completes.
          if (/(^|\n)\d?L\|[^\n]*\n$/.test(this.textBuffer)) {
            this.flush(messages)
          }
          break
        case EOT:
          // End of transmission (E1381 analyzers, e.g. Maglumi) -> flush.
          this.flush(messages)
          break
        case ACK:
        case LF:
          break
        case CR:
          this.textBuffer += '\n'
          break
        default:
          this.textBuffer += String.fromCharCode(byte)
      }
    }

    return messages
  }

  /** Emit the accumulated records as one message and reset the buffer. */
  private flush(messages: ProtocolMessage[]): void {
    if (this.textBuffer.trim().length > 0) {
      messages.push(this.buildMessage(this.textBuffer))
    }
    this.textBuffer = ''
  }

  /** Accept already-textual ASTM (used by the simulator). */
  feedText(text: string): ProtocolMessage[] {
    return [this.buildMessage(text.replace(/\r/g, '\n'))]
  }

  private buildMessage(text: string): ProtocolMessage {
    const records = text
      .split('\n')
      .map((line) => line.replace(/^\d(?=[A-Z]\|)/, '')) // strip leading frame number
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split('|'))
    return { protocol: 'astm', records, raw: text.trim() }
  }

  reset(): void {
    this.textBuffer = ''
  }
}
