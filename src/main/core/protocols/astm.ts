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
 * This implementation is a faithful scaffold: it accumulates frame text between
 * STX/ETX(ETB), strips the checksum, splits records on CR, and returns the
 * E1394 rows. Checksum verification and full retransmit handling are marked for
 * the hardening phase.
 */
export class AstmProtocol implements IProtocol {
  readonly kind = 'astm'
  private textBuffer = ''
  // After ETX/ETB the analyzer sends a 2-char checksum (e.g. "FB") then CR LF.
  // We must DISCARD those bytes: if appended to the buffer they glue onto the
  // record's last field (e.g. "...|N" -> "...|NFB"), corrupting a result flag or
  // trailing value and causing the result to be mis-mapped or skipped.
  private inChecksum = false
  /** Callback used by the orchestrator to push low-level ACKs back. */
  onControl?: (byte: number) => void

  /**
   * `flushOnTerminator`: the analyzer uses bare ASTM framing with no E1381
   * envelope — no inter-record CR and no closing <EOT> — ending the message with
   * the L terminator (Agappe Mispa Maestro / BioHermes BH60). Off by default, so
   * standard E1381 analyzers (Maglumi, …) keep their exact behavior.
   */
  constructor(private readonly flushOnTerminator = false) {}

  feed(chunk: Buffer): ProtocolMessage[] {
    const messages: ProtocolMessage[] = []

    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]
      switch (byte) {
        case ENQ:
          // Analyzer requests to send. Reply ACK (handled by orchestrator).
          this.onControl?.(ACK)
          this.textBuffer = ''
          this.inChecksum = false
          break
        case STX:
          // Start of a frame; the next char is the frame number (stripped later).
          this.inChecksum = false
          break
        case ETX:
        case ETB:
          // End of frame block; ACK it. The next bytes are the frame checksum,
          // which we skip until the CR/LF frame terminator.
          this.onControl?.(ACK)
          this.inChecksum = true
          // Bare-framing analyzers (Agappe Mispa Maestro / BH60) omit the
          // inter-record CR and the closing <EOT>, ending the message with the L
          // terminator. For those only, separate the record here and flush on L —
          // standard E1381 analyzers (flushOnTerminator=false) are unaffected.
          if (this.flushOnTerminator) {
            if (this.textBuffer.length > 0 && !this.textBuffer.endsWith('\n')) {
              this.textBuffer += '\n'
            }
            if (/(^|\n)\d?L\|[^\n]*\n$/.test(this.textBuffer)) {
              if (this.textBuffer.trim().length > 0) {
                messages.push(this.buildMessage(this.textBuffer))
              }
              this.textBuffer = ''
              this.inChecksum = false
            }
          }
          break
        case EOT:
          // End of transmission -> flush a complete message.
          if (this.textBuffer.trim().length > 0) {
            messages.push(this.buildMessage(this.textBuffer))
          }
          this.textBuffer = ''
          this.inChecksum = false
          break
        case ACK:
        case LF:
          break
        case CR:
          // Frame terminator: ends any checksum run and separates records.
          this.inChecksum = false
          this.textBuffer += '\n'
          break
        default:
          // Drop the post-ETX checksum digits; keep everything else.
          if (!this.inChecksum) this.textBuffer += String.fromCharCode(byte)
      }
    }

    return messages
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
    this.inChecksum = false
  }
}
