import type { IProtocol, ProtocolMessage } from './IProtocol'

/**
 * Beckman Coulter AU480 / AU680 / AU5800 / DxC AU "Online" host protocol.
 *
 * Source of truth: *AU680/AU480 Instrument Online Specification (Jan-2011 v9)*.
 * Unlike pipe-delimited ASTM E1394, the AU speaks a proprietary fixed-field block
 * format. Each message is framed:
 *
 *     <STX> <distinction(2)> <fixed-width data...> <ETX|ETB> <BCC>
 *
 * - Long messages split into blocks: intermediate blocks end with <ETB>, the
 *   final block with <ETX>. The receiver ACKs each block (protocol "Class B").
 * - <BCC> is a single byte = XOR of every byte from the distinction code through
 *   the end of the message data (i.e. everything between STX and ETX/ETB,
 *   excluding STX itself but including the ETX/ETB terminator per spec §"BCC").
 * - This protocol does NOT use ENQ/EOT phasing; we still tolerate them.
 *
 * Three message families matter for a LIS:
 *   R…  Sample-information REQUEST  (analyzer -> host): "what tests for this sample?"
 *       RB start · R∆ normal · RH repeat · Rh auto-repeat · RE end
 *   S…  Sample-information RESPONSE (host -> analyzer): the ordered Online Test Nos
 *       S∆ normal · SH repeat · Sh auto-repeat · SE end
 *   D…  Analysis-data RESULT        (analyzer -> host): per-test results
 *       D∆ normal · DH repeat · DR reagent-blank · DA calibration · DQ QC · d∆ STAT
 *
 * Sample identity: the **Sample ID (barcode, 4–26 chars)** rides directly in the
 * R/S/D records (when "Sample ID" transmission is enabled on the analyzer),
 * alongside the 4-digit analyzer Sample No. We read it straight from the frame
 * and fall back to an S→D rack/cup correlation only when it is absent.
 *
 * Field widths are SITE-CONFIGURABLE (Online > Format/Requisition Configuration).
 * `AuFormat` captures them; `DEFAULT_AU_FORMAT` matches the documented defaults +
 * the configuration we instruct the lab to set. Certify against one real captured
 * frame before trusting live patient results.
 */

// Low-level control characters.
const STX = 0x02
const ETX = 0x03
const EOT = 0x04
const ENQ = 0x05
const ACK = 0x06
const NAK = 0x15
const ETB = 0x17
const CR = 0x0d
const LF = 0x0a

/** Site-configurable fixed-field widths + enabled fields (Online setup screens). */
export interface AuFormat {
  /** "Device No." — 0 when unchecked, else 2. */
  systemNo: number
  rack: number
  cup: number
  sampleNo: number
  sampleType: number
  /** Sample ID (barcode) width; 0 when Sample ID transmission is disabled. */
  sampleId: number
  /** "Dummy" pad field that follows the sample id (spaces). */
  dummy: number
  dataClass: number
  /** Sex field, once per sample; 0 when disabled. */
  sex: number
  /** Online Test No. width — 2 (01–99) or 3 (001–120). */
  testNo: number
  /** Dilution info width; 0 when disabled. */
  diluent: number
  /** Result value width — 6 (default) or 9. */
  result: number
  /** Data-marks/flags width — 2 (default) or up to 8. */
  marks: number
  /** Whether the analyzer appends a 1-byte XOR BCC after ETX/ETB. */
  bcc: boolean
}

/**
 * Default format — CALIBRATED against a real AU480 "Online" frame captured on the
 * live host link (COM1, 8-N-1) at this site:
 *
 *   D 000301 0001             9063962    E0                         001 161.3
 *   └2┘└rack┘cup└ sampleNo ┘└──── sampleId(19, right-just) ───┘└── pad/demographics ──┘└grp┘
 *
 * Fixed header is 64 chars; result groups are 11 chars = testNo(3) + result(6) +
 * marks(2) with no diluent digit. Online Test No. is 3 digits (001–099). The
 * sample barcode rides right-justified in a 19-char field; the 31-char `dummy`
 * pad absorbs the analyzer's data-class ("E0") + blank demographic slots that
 * precede the result groups. `sex` is kept 0 (it doubles as the per-test slot in
 * host-query S responses). Re-certify if the analyzer's Online format is changed.
 */
export const DEFAULT_AU_FORMAT: AuFormat = {
  systemNo: 0,
  rack: 4,
  cup: 2,
  sampleNo: 5,
  sampleType: 1,
  sampleId: 19,
  dummy: 31,
  dataClass: 0,
  sex: 0,
  testNo: 3,
  diluent: 0,
  result: 6,
  marks: 2,
  bcc: false
}

/** One repeating result group width: testNo + diluent + result + marks. */
export function auGroupWidth(fmt: AuFormat): number {
  return fmt.testNo + fmt.diluent + fmt.result + fmt.marks
}

/** Width of the fixed per-sample header that precedes the variable part. */
export function auHeaderWidth(fmt: AuFormat): number {
  return (
    2 /* distinction */ +
    fmt.systemNo +
    fmt.rack +
    fmt.cup +
    fmt.sampleNo +
    fmt.sampleType +
    fmt.sampleId +
    fmt.dummy +
    fmt.dataClass +
    fmt.sex
  )
}

export interface AuHeader {
  distinction: string
  rack: string
  cup: string
  sampleNo: string
  /** Sample ID (barcode) when present, else ''. */
  sampleId: string
  sampleType: string
  /** Offset where the variable part (result/test groups) begins. */
  bodyOffset: number
}

/** Slice the fixed per-sample header shared by R…, S… and D… messages. */
export function parseAuHeader(block: string, fmt: AuFormat = DEFAULT_AU_FORMAT): AuHeader {
  let i = 0
  const take = (n: number): string => {
    const s = block.slice(i, i + n)
    i += n
    return s
  }
  const distinction = take(2)
  take(fmt.systemNo)
  const rack = take(fmt.rack).trim()
  const cup = take(fmt.cup).trim()
  const sampleNo = take(fmt.sampleNo).trim()
  const sampleType = take(fmt.sampleType)
  const sampleId = take(fmt.sampleId).trim()
  take(fmt.dummy)
  take(fmt.dataClass)
  take(fmt.sex)
  return { distinction, rack, cup, sampleNo, sampleId, sampleType, bodyOffset: i }
}

/** Position key used to correlate a D result with an S response by rack/cup. */
export function auPositionKey(rack: string, cup: string): string {
  return `${rack}|${cup}`
}

/** XOR every byte of `body` (the message text incl. its ETX/ETB terminator). */
export function auBcc(body: string): number {
  let bcc = 0
  for (let i = 0; i < body.length; i++) bcc ^= body.charCodeAt(i) & 0xff
  return bcc & 0xff
}

const isRequest = (d: string): boolean => d[0] === 'R'
const isResponse = (d: string): boolean => d[0] === 'S'
const isResult = (d: string): boolean => d[0] === 'D' || d[0] === 'd'

/** Frame an outbound AU message body into STX … ETX [BCC] (single block). */
export function frameAuMessage(body: string, fmt: AuFormat = DEFAULT_AU_FORMAT): Buffer {
  const text = body + String.fromCharCode(ETX)
  let wire = String.fromCharCode(STX) + text
  if (fmt.bcc) wire += String.fromCharCode(auBcc(text))
  return Buffer.from(wire, 'latin1')
}

/**
 * Drives the Class-B handshake to push one S… (order) block to the analyzer:
 * write the framed block, wait for ACK (or retransmit up to 3× on NAK). The
 * owner routes inbound ACK/NAK bytes to `feedByte` while `isBusy()` is true.
 */
export class AuHostQuerySender {
  private frame: Buffer | null = null
  private retries = 0
  private resolve?: () => void
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly write: (b: Buffer) => void,
    private readonly log?: (m: string) => void,
    private readonly fmt: AuFormat = DEFAULT_AU_FORMAT
  ) {}

  isBusy(): boolean {
    return this.frame !== null
  }

  send(body: string): Promise<void> {
    if (this.isBusy()) return Promise.resolve()
    this.frame = frameAuMessage(body, this.fmt)
    this.retries = 0
    this.write(this.frame)
    this.arm()
    return new Promise((res) => {
      this.resolve = res
    })
  }

  feedByte(byte: number): void {
    if (!this.isBusy()) return
    if (byte === ACK) {
      this.log?.('order response ACKed by analyzer')
      this.finish()
    } else if (byte === NAK) {
      if (this.retries >= 3) {
        this.log?.('order response NAKed 3×, aborting')
        this.finish()
        return
      }
      this.retries++
      this.arm()
      if (this.frame) this.write(this.frame)
    }
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.log?.('order response timed out waiting for ACK')
      this.finish()
    }, 5000)
  }

  private finish(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.frame = null
    const res = this.resolve
    this.resolve = undefined
    res?.()
  }
}

export class BeckmanAuProtocol implements IProtocol {
  readonly kind = 'beckman-au' as const
  /** Pushes ACK/NAK/control bytes back to the analyzer (wired by the orchestrator). */
  onControl?: (byte: number) => void

  constructor(private readonly fmt: AuFormat = DEFAULT_AU_FORMAT) {}

  private msg = '' // accumulated message text across ETB-split blocks
  private block = '' // current block text
  private inBlock = false
  private afterEtx = false // next byte is the BCC to validate/skip
  private pendingTerminator = 0 // ETX or ETB awaiting its BCC byte
  /** rack|cup -> sample barcode, learned from S responses (correlation fallback). */
  private barcodeByPos = new Map<string, string>()

  feed(chunk: Buffer): ProtocolMessage[] {
    const out: ProtocolMessage[] = []
    for (const byte of chunk) {
      // A BCC byte immediately follows ETX/ETB when enabled — consume & verify it.
      if (this.afterEtx) {
        this.afterEtx = false
        if (this.fmt.bcc) {
          const expected = auBcc(this.block + String.fromCharCode(this.pendingTerminator))
          if ((byte & 0xff) !== expected) {
            this.onControl?.(NAK) // checksum mismatch — ask for retransmit
            this.block = ''
            this.inBlock = false
            continue
          }
        }
        this.finishBlock(this.pendingTerminator === ETX, out)
        continue
      }

      switch (byte) {
        case ENQ:
          this.onControl?.(ACK)
          this.resetMessage()
          break
        case STX:
          this.inBlock = true
          this.block = ''
          break
        case ETB:
        case ETX:
          if (this.fmt.bcc) {
            // Defer ACK/flush until the trailing BCC byte is validated.
            this.afterEtx = true
            this.pendingTerminator = byte
          } else {
            this.onControl?.(ACK)
            this.finishBlock(byte === ETX, out)
          }
          break
        case EOT:
          this.resetMessage()
          break
        case ACK:
        case NAK:
        case CR:
        case LF:
          break
        default:
          if (this.inBlock) this.block += String.fromCharCode(byte)
      }
    }
    return out
  }

  /** Commit the current block; on a final (ETX) block decode the whole message. */
  private finishBlock(final: boolean, out: ProtocolMessage[]): void {
    this.msg += this.block
    this.block = ''
    this.inBlock = false
    if (!final) return // ETB — more blocks follow
    if (this.msg.trim().length > 0) {
      const m = this.decodeBlock(this.msg)
      if (m) out.push(m)
    }
    this.msg = ''
  }

  private resetMessage(): void {
    this.msg = ''
    this.block = ''
    this.inBlock = false
    this.afterEtx = false
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

  /** Decode one complete (reassembled) message into a ProtocolMessage. */
  private decodeBlock(block: string): ProtocolMessage | null {
    const distinction = block.slice(0, 2)

    // Sample-information REQUEST (analyzer asks which tests to run). Surface the
    // sample identity so the orchestrator can answer with an S response.
    if (isRequest(distinction)) {
      const h = parseAuHeader(block, this.fmt)
      const sid = h.sampleId || h.sampleNo
      return {
        protocol: 'beckman-au',
        records: [['R', sid, h.rack, h.cup, h.sampleNo, h.sampleType]],
        raw: block
      }
    }

    // Sample-information RESPONSE — normally we SEND these; if we ever receive one
    // (echo/loopback), learn the barcode for rack/cup correlation.
    if (isResponse(distinction)) {
      const h = parseAuHeader(block, this.fmt)
      if (h.sampleId) this.barcodeByPos.set(auPositionKey(h.rack, h.cup), h.sampleId)
      return { protocol: 'beckman-au', records: [['S', h.sampleId]], raw: block }
    }

    // Analysis-data RESULT. Prefer the in-frame Sample ID barcode; fall back to a
    // correlated barcode, then the analyzer's 4-digit sample number.
    if (isResult(distinction)) {
      const h = parseAuHeader(block, this.fmt)
      const sampleId =
        h.sampleId ||
        this.barcodeByPos.get(auPositionKey(h.rack, h.cup)) ||
        h.sampleNo ||
        `R${h.rack}C${h.cup}`
      return { protocol: 'beckman-au', records: [[distinction.trim() || 'D', sampleId]], raw: block }
    }

    // DB/DE transmission markers and anything else: surface raw, no results.
    return { protocol: 'beckman-au', records: [[distinction.trim()]], raw: block }
  }

  reset(): void {
    this.resetMessage()
    this.barcodeByPos.clear()
  }
}
