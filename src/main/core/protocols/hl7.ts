import type { IProtocol, ProtocolMessage } from './IProtocol'

// HL7 Minimal Lower Layer Protocol (MLLP) framing bytes.
const VT = 0x0b // start block
const FS = 0x1c // end block
const CR = 0x0d

/**
 * HL7 v2.x over MLLP decoder.
 *
 * MLLP frames a message as <VT> message <FS><CR>. Segments are separated by CR
 * and fields by '|'. SNIBE Maglumi (X-series) supports HL7 in addition to ASTM,
 * using MSH / PID / OBR / OBX segments. This scaffold extracts the segments;
 * OBX value parsing into CanonicalResults happens in the driver.
 */
export class Hl7Protocol implements IProtocol {
  readonly kind = 'hl7'
  private buffer = Buffer.alloc(0)

  feed(chunk: Buffer): ProtocolMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: ProtocolMessage[] = []

    let start = this.buffer.indexOf(VT)
    let end = this.buffer.indexOf(FS)
    while (start !== -1 && end !== -1 && end > start) {
      const body = this.buffer.subarray(start + 1, end).toString('utf8')
      messages.push(this.buildMessage(body))
      // Drop processed bytes (FS + trailing CR).
      this.buffer = this.buffer.subarray(end + 2)
      start = this.buffer.indexOf(VT)
      end = this.buffer.indexOf(FS)
    }

    return messages
  }

  /** Accept already-textual HL7 (used by the simulator). */
  feedText(text: string): ProtocolMessage[] {
    return [this.buildMessage(text)]
  }

  private buildMessage(body: string): ProtocolMessage {
    const records = body
      .split(/\r\n|\r|\n/)
      .map((seg) => seg.trim())
      .filter((seg) => seg.length > 0)
      .map((seg) => seg.split('|'))
    return { protocol: 'hl7', records, raw: body.replace(/\r/g, '\n').trim() }
  }

  reset(): void {
    this.buffer = Buffer.alloc(0)
  }

  /** Wrap an HL7 message body in MLLP framing for transmission. */
  static frame(body: string): Buffer {
    return Buffer.concat([
      Buffer.from([VT]),
      Buffer.from(body, 'utf8'),
      Buffer.from([FS, CR])
    ])
  }
}
