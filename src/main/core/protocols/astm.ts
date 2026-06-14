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
          // Start of a frame; the next char is the frame number (skip it).
          break
        case ETX:
        case ETB:
          // End of frame block; ACK it. We keep accumulating records.
          this.onControl?.(ACK)
          break
        case EOT:
          // End of transmission -> flush a complete message.
          if (this.textBuffer.trim().length > 0) {
            messages.push(this.buildMessage(this.textBuffer))
          }
          this.textBuffer = ''
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
