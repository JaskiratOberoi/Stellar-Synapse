import type { IProtocol, ProtocolMessage } from './IProtocol'

/**
 * Beckman Coulter AU480 / AU680 / AU5800 "Online" host protocol decoder.
 *
 * Unlike pipe-delimited ASTM E1394, the AU analyzers speak a proprietary
 * fixed-field block format (AU680/AU480 Online Specification). Each message is
 * framed:
 *
 *     <STX> <distinction(2)> <fixed-width data...> <ETX> <BCC>
 *
 * and long messages are split into blocks terminated by <ETB> (intermediate) /
 * <ETX> (final). Tests are identified by a 2-digit "Online Test No." (the
 * `Online Test No.` setup screen), results are space-padded fixed-width numbers,
 * and the host ACKs each block. The 2-char distinction code names the message:
 *
 *   DB  analysis-data transmission start      D∆  normal sample result
 *   DH  repeat-run result                     DR  reagent-blank result
 *   DA  calibration result                    DQ  QC result
 *   d∆  STAT-quick result                     DE  analysis-data transmission end
 *   S∆/SH/Sh  sample-information response (links rack/cup -> sample barcode)
 *
 * The result (`D…`) message carries only rack/cup + a 4-digit sample number, so
 * we correlate it with the barcode learned from the matching `S…` message.
 *
 * NOTE: field widths below match this site's Format Configuration (Rack No=4,
 * Online Test No=2, Result=6, Data Marks=2, Device No off => System No 0 digits,
 * BCC off, ETB off). The exact fixed-part offsets must be certified against one
 * real captured frame before trusting live patient results — see drivers/beckmanAu.ts.
 */

// Low-level control characters.
const STX = 0x02
const ETX = 0x03
const EOT = 0x04
const ENQ = 0x05
const ACK = 0x06
const ETB = 0x17
const CR = 0x0d
const LF = 0x0a

/** Fixed-field widths (from the analyzer Format Configuration). */
export const AU_WIDTHS = {
  distinction: 2,
  systemNo: 0, // "Device No." unchecked
  rack: 4,
  cup: 2,
  sampleNo: 4,
  sampleType: 1,
  dummy: 4,
  dataClass: 1,
  sex: 1,
  testNo: 2,
  diluent: 1, // "Dilution Inf." used
  result: 6,
  marks: 2
} as const

/** Total width of the per-sample fixed header that precedes the result groups. */
export const AU_HEADER_WIDTH =
  AU_WIDTHS.distinction +
  AU_WIDTHS.systemNo +
  AU_WIDTHS.rack +
  AU_WIDTHS.cup +
  AU_WIDTHS.sampleNo +
  AU_WIDTHS.sampleType +
  AU_WIDTHS.dummy +
  AU_WIDTHS.dataClass +
  AU_WIDTHS.sex

/** Width of one repeating result group: testNo + diluent + result + marks. */
export const AU_GROUP_WIDTH =
  AU_WIDTHS.testNo + AU_WIDTHS.diluent + AU_WIDTHS.result + AU_WIDTHS.marks

export interface AuHeader {
  distinction: string
  rack: string
  cup: string
  sampleNo: string
  /** Offset where the variable part (result groups / barcode) begins. */
  bodyOffset: number
}

/** Slice the per-sample fixed header that prefixes both S… and D… messages. */
export function parseAuHeader(block: string): AuHeader {
  let i = 0
  const take = (n: number): string => {
    const s = block.slice(i, i + n)
    i += n
    return s
  }
  const distinction = take(AU_WIDTHS.distinction)
  take(AU_WIDTHS.systemNo)
  const rack = take(AU_WIDTHS.rack).trim()
  const cup = take(AU_WIDTHS.cup).trim()
  const sampleNo = take(AU_WIDTHS.sampleNo).trim()
  take(AU_WIDTHS.sampleType)
  take(AU_WIDTHS.dummy)
  take(AU_WIDTHS.dataClass)
  take(AU_WIDTHS.sex)
  return { distinction, rack, cup, sampleNo, bodyOffset: i }
}

/** Position key used to correlate a result message with its sample barcode. */
export function auPositionKey(rack: string, cup: string): string {
  return `${rack}|${cup}`
}

const isResultMessage = (d: string): boolean => d[0] === 'D' || d[0] === 'd'
const isSampleInfoMessage = (d: string): boolean => d[0] === 'S'

export class BeckmanAuProtocol implements IProtocol {
  readonly kind = 'beckman-au' as const
  /** Pushes ACK/control bytes back to the analyzer (wired by the orchestrator). */
  onControl?: (byte: number) => void

  private msg = '' // accumulated message text across blocks
  private block = '' // current block text
  private inBlock = false
  /** rack|cup -> sample barcode, learned from S… messages. */
  private barcodeByPos = new Map<string, string>()

  feed(chunk: Buffer): ProtocolMessage[] {
    const out: ProtocolMessage[] = []
    for (const byte of chunk) {
      switch (byte) {
        case ENQ:
          this.onControl?.(ACK)
          this.msg = ''
          this.block = ''
          this.inBlock = false
          break
        case STX:
          this.inBlock = true
          this.block = ''
          break
        case ETB: // intermediate block end — more blocks follow
          this.onControl?.(ACK)
          this.msg += this.block
          this.inBlock = false
          break
        case ETX: // final block — flush the whole message
          this.onControl?.(ACK)
          this.msg += this.block
          if (this.msg.trim().length > 0) {
            const m = this.decodeBlock(this.msg)
            if (m) out.push(m)
          }
          this.msg = ''
          this.block = ''
          this.inBlock = false
          break
        case EOT:
          this.msg = ''
          this.block = ''
          this.inBlock = false
          break
        case CR:
        case LF:
          break
        default:
          // Only data inside STX…ETB/ETX is text; a trailing BCC byte arrives
          // while inBlock is false and is therefore ignored.
          if (this.inBlock) this.block += String.fromCharCode(byte)
      }
    }
    return out
  }

  /** Accept already-textual frames (one block per line) from the simulator. */
  feedText(text: string): ProtocolMessage[] {
    const out: ProtocolMessage[] = []
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().length === 0) continue
      const m = this.decodeBlock(line)
      if (m) out.push(m)
    }
    return out
  }

  /** Decode one complete block into a message, updating barcode correlation. */
  private decodeBlock(block: string): ProtocolMessage | null {
    const distinction = block.slice(0, AU_WIDTHS.distinction)

    // Keep `raw` at its exact fixed width — trailing pad spaces are significant
    // to the parser's fixed-field slicing, so we must not trim them away.
    if (isSampleInfoMessage(distinction)) {
      const h = parseAuHeader(block)
      // Remaining body (patient info disabled here) is the sample barcode.
      const barcode = block.slice(h.bodyOffset).trim()
      if (barcode) this.barcodeByPos.set(auPositionKey(h.rack, h.cup), barcode)
      return { protocol: 'beckman-au', records: [['S', barcode]], raw: block }
    }

    if (isResultMessage(distinction)) {
      const h = parseAuHeader(block)
      const barcode = this.barcodeByPos.get(auPositionKey(h.rack, h.cup))
      // Prefer the correlated barcode; else fall back to the 4-digit sample no.
      const sampleId = barcode || h.sampleNo || `R${h.rack}C${h.cup}`
      return { protocol: 'beckman-au', records: [[distinction.trim() || 'D', sampleId]], raw: block }
    }

    // DB/DE transmission markers and anything else: surface raw, no results.
    return { protocol: 'beckman-au', records: [[distinction.trim()]], raw: block }
  }

  reset(): void {
    this.msg = ''
    this.block = ''
    this.inBlock = false
    this.barcodeByPos.clear()
  }
}
