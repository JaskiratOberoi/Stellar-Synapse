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

    // Frame on the <FS> end-block. The <VT> start-block is OPTIONAL: standard MLLP
    // wraps a message as <VT> body <FS><CR>, but some analyzers (Agappe Mispa HX 58
    // / "F 580") omit the <VT> and send `body <FS>`. When a <VT> precedes the <FS>
    // we start just after it; otherwise the body is everything up to the <FS>.
    let end = this.buffer.indexOf(FS)
    while (end !== -1) {
      const vt = this.buffer.indexOf(VT)
      const bodyStart = vt !== -1 && vt < end ? vt + 1 : 0
      const body = this.buffer.subarray(bodyStart, end).toString('utf8').trim()
      if (body) messages.push(this.buildMessage(body))
      // Consume through the <FS> and an optional trailing <CR>.
      this.buffer = this.buffer.subarray(this.buffer[end + 1] === CR ? end + 2 : end + 1)
      end = this.buffer.indexOf(FS)
    }

    return messages
  }

  /** Accept already-textual HL7 (used by the simulator). */
  feedText(text: string): ProtocolMessage[] {
    return [this.buildMessage(text)]
  }

  private buildMessage(body: string): ProtocolMessage {
    // Split into segments. Standard HL7 delimits segments with <CR>; some analyzers
    // (Agappe Mispa HX 58 / "F 580") send a FLATTENED message with the segments
    // simply concatenated (no <CR> between them). Insert a <CR> before any known
    // segment header that directly follows a field separator so both the standard
    // and flattened shapes split identically. (A `\rOBX|` in standard HL7 is not
    // preceded by `|`, so real messages are left untouched.)
    const normalized = body.replace(
      /\|(?=(?:MSH|PID|PV1|PV2|OBR|OBX|NTE|ORC|SPM|NK1|AL1|DG1|PD1|GT1|IN1|MSA|QRD|QRF|ERR)\|)/g,
      '|\r'
    )
    const records = normalized
      .split(/\r\n|\r|\n/)
      .map((seg) => seg.trim())
      .filter((seg) => seg.length > 0)
      .map((seg) => seg.split('|'))
    return { protocol: 'hl7', records, raw: normalized.replace(/\r/g, '\n').trim() }
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
