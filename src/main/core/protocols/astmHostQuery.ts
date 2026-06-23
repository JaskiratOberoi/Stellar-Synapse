/**
 * ASTM E1381 outbound transmission for host-query (LIS -> analyzer) responses.
 *
 * When a bidirectional analyzer (e.g. Maglumi X3 with "Auto Download Test
 * Assay") loads a sample, it sends an ASTM Query (Q) record asking the LIS which
 * tests to run for that barcode. The LIS must answer by *initiating* its own
 * transmission of Order (O) records:
 *
 *     LIS -> <ENQ>            (request to send)
 *     ana -> <ACK>
 *     LIS -> <STX>1H|...<CR><ETX>cc<CR><LF>
 *     ana -> <ACK>
 *     LIS -> <STX>2P|1<CR><ETX>cc<CR><LF>
 *     ana -> <ACK>
 *     LIS -> <STX>3O|1|SID||^^^TSH<CR><ETX>cc<CR><LF>
 *     ana -> <ACK>
 *     LIS -> <STX>4L|1|N<CR><ETX>cc<CR><LF>
 *     ana -> <ACK>
 *     LIS -> <EOT>
 *
 * This module frames records per E1381 (STX, frame number, checksum, ETX) and
 * drives that ENQ/ACK handshake, fed by the inbound ACK/NAK bytes from the
 * analyzer.
 */

const STX = 0x02
const ETX = 0x03
const EOT = 0x04
const ENQ = 0x05
const ACK = 0x06
const NAK = 0x15

/**
 * Build the ASTM order records that answer a host query for `sid` with the given
 * instrument analyte codes. Returns logical records (the framer adds E1381
 * framing).
 *
 * Replicated BYTE-FOR-BYTE from the live, working ElabAssistLite interface
 * (Genomic Labs, 2026-06, logINMessage / logDetails). The X3's own query is
 * answered with exactly:
 *
 *   H|\^&||PSWD| MAGLUMI X3 |||||Lis||P|E1394-97|20180319
 *   P|1
 *   O|1|<sid>||^^^<ch1>\^^^<ch2>\^^^<ch3>|R
 *   L|1|N
 *
 * Two things proved essential and are intentionally NOT "smart":
 *  - ALL ordered tests ride in a SINGLE O record, their universal-test-IDs joined
 *    by the ASTM repeat delimiter "\" (NOT one O record per test). The X3 reads
 *    the whole assay list from that one field.
 *  - The header sender is the literal " MAGLUMI X3 " (leading/trailing spaces)
 *    and the date is the fixed "20180319" — the working interface does NOT echo
 *    the analyzer's own query header, and the X3 accepts the order regardless.
 *
 * `analyzerName` / `hostName` remain overridable for other ASTM analyzers, but
 * default to the exact values the live X3 interface sends.
 */
export function buildAstmOrderRecords(
  sid: string,
  analyteCodes: string[],
  analyzerName = ' MAGLUMI X3 ',
  hostName = 'Lis'
): string[][] {
  const records: string[][] = []
  records.push(['H', '\\^&', '', 'PSWD', analyzerName, '', '', '', '', hostName, '', 'P', 'E1394-97', '20180319'])
  records.push(['P', '1'])
  if (analyteCodes.length > 0) {
    // One O record, all assays in field 5 joined by the ASTM repeat delimiter "\".
    const universal = analyteCodes.map((code) => `^^^${code}`).join('\\')
    records.push(['O', '1', sid, '', universal, 'R'])
  }
  records.push(['L', '1', 'N'])
  return records
}

/**
 * Frame ALL records into ONE ASTM frame, SNIBE-style. A real Maglumi sends its
 * entire message (H + Q + L, or H + P + O + L) inside a single STX...ETX frame
 * with the records CR-separated — NOT one frame per record. Sending separate
 * frames makes the X3 read the SID but never assemble the order, so we mirror
 * its own framing.
 *
 * Layout:  STX <frameNum> rec1 CR rec2 CR ... recN ETX <C1C2> CR LF
 * The checksum covers frameNum + records(+CRs) + ETX. No CR before ETX (verified
 * against the single-record example "2P|1<ETX>32").
 */
export function frameAstmMessage(records: string[][]): Buffer {
  const frameNum = 1
  const text = records.map((r) => r.join('|')).join('\r')
  const body = `${frameNum}${text}${String.fromCharCode(ETX)}`
  let sum = 0
  for (let k = 0; k < body.length; k++) sum = (sum + body.charCodeAt(k)) & 0xff
  const cs = sum.toString(16).toUpperCase().padStart(2, '0')
  return Buffer.from(String.fromCharCode(STX) + body + cs + '\r\n', 'latin1')
}

/**
 * Frame each record as its OWN ASTM frame, with incrementing frame numbers
 * (1-7, rolling to 0). This is the format SNIBE's own host-order download uses
 * for the MAGLUMI X3: the X3 reads only one record per frame, so every record
 * must arrive in its own frame within the single response session.
 *
 * IMPORTANT: every frame terminates with ETX (0x03) — NOT ETB. SNIBE's
 * documented working host->analyzer order log (Chapter 16 / "requests.txt")
 * sends H, P, O, O, L as five separate frames, each ending `<ETX>cc<CR><LF>`,
 * with continuous frame numbers 1..5. Using ETB for the intermediate frames
 * (standard E1381 multi-frame continuation) makes the X3 silently drop the
 * order, because it treats each single-record frame as a complete unit. The
 * checksum covers frameNum + record + ETX.
 */
export function frameAstmPerRecord(records: string[][]): Buffer[] {
  return records.map((rec, i) => {
    const frameNum = (i + 1) % 8 // 1,2,…,7,0,1,…
    const body = `${frameNum}${rec.join('|')}${String.fromCharCode(ETX)}`
    let sum = 0
    for (let k = 0; k < body.length; k++) sum = (sum + body.charCodeAt(k)) & 0xff
    const cs = sum.toString(16).toUpperCase().padStart(2, '0')
    return Buffer.from(String.fromCharCode(STX) + body + cs + '\r\n', 'latin1')
  })
}

/**
 * Frame an order response in SNIBE's "simple" host-download format used by the
 * MAGLUMI X3 (Chapter 16 §16.4.2), VERIFIED against the bytes a live X3 sends in
 * its own query (Genomic Labs, 2026-06):
 *
 *   LIS -> <ENQ>                                   ana -> <ACK>
 *   LIS -> <STX>                                   ana -> <ACK>
 *   LIS -> H|...<CR>P|1<CR>O|1|SID||^^^CH|R<CR>...L|1|N<CR>   ana -> <ACK>
 *   LIS -> <ETX>                                   ana -> <ACK>
 *   LIS -> <EOT>
 *
 * Crucially there are NO frame numbers and NO checksums — the X3 sends none and
 * silently refuses standard E1381 frames (`<STX>1H|...<ETX>cc`). All records go
 * in ONE CR-separated block (each record, including L, ends with CR).
 *
 * Returned as ACK-gated units. We keep STX+block+ETX as a single write (the X3
 * reads it as one STX..ETX message regardless of ACK timing); the sender adds
 * the leading ENQ and trailing EOT.
 */
export function frameAstmSimple(records: string[][]): Buffer[] {
  const block = records.map((r) => r.join('|')).join('\r') + '\r'
  const frame = String.fromCharCode(STX) + block + String.fromCharCode(ETX)
  return [Buffer.from(frame, 'latin1')]
}

type SenderState = 'idle' | 'wait-enq-ack' | 'wait-frame-ack' | 'done'

/**
 * Drives the ENQ/ACK handshake to push a framed message to the analyzer.
 * The owner routes inbound bytes to `feedByte()` while `isBusy()` is true.
 */
export class AstmHostQuerySender {
  private state: SenderState = 'idle'
  private frames: Buffer[] = []
  private idx = 0
  private retries = 0
  private resolve?: () => void
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly write: (b: Buffer) => void,
    private readonly log?: (m: string) => void
  ) {}

  isBusy(): boolean {
    return this.state !== 'idle' && this.state !== 'done'
  }

  /** Send the records; resolves when the EOT is sent or the attempt aborts. */
  send(records: string[][], perRecord = false): Promise<void> {
    if (this.isBusy()) return Promise.resolve()
    // Default: whole message in ONE frame (records CR-separated). perRecord: one
    // frame per record (X3 multi-test — it reads only one O record per frame).
    return this.sendFrames(perRecord ? frameAstmPerRecord(records) : [frameAstmMessage(records)])
  }

  /**
   * Send pre-built, ACK-gated transmission units (e.g. the MAGLUMI X3 simple
   * format from `frameAstmSimple`). The ENQ/ACK handshake, per-unit ACK wait, and
   * trailing EOT are identical to `send`; only the framing differs.
   */
  sendFrames(frames: Buffer[]): Promise<void> {
    if (this.isBusy()) return Promise.resolve()
    this.frames = frames
    this.idx = 0
    this.retries = 0
    this.state = 'wait-enq-ack'
    this.write(Buffer.from([ENQ]))
    this.arm()
    return new Promise((res) => {
      this.resolve = res
    })
  }

  feedByte(byte: number): void {
    if (!this.isBusy()) return
    if (this.state === 'wait-enq-ack') {
      if (byte === ACK) {
        this.arm()
        this.sendNextFrame()
      } else if (byte === NAK) {
        // Analyzer not ready to receive — abort this attempt.
        this.log?.('host-query: analyzer replied NAK to ENQ, aborting')
        this.finish()
      }
    } else if (this.state === 'wait-frame-ack') {
      if (byte === ACK) {
        this.arm()
        this.idx++
        this.sendNextFrame()
      } else if (byte === NAK) {
        this.resendFrame()
      }
    }
  }

  private sendNextFrame(): void {
    if (this.idx >= this.frames.length) {
      this.write(Buffer.from([EOT]))
      this.log?.(`host-query: sent ${this.frames.length} frames + EOT`)
      this.finish()
      return
    }
    this.state = 'wait-frame-ack'
    this.write(this.frames[this.idx])
  }

  private resendFrame(): void {
    if (this.retries >= 3) {
      this.log?.('host-query: too many NAKs, aborting')
      this.finish()
      return
    }
    this.retries++
    this.arm()
    this.write(this.frames[this.idx])
  }

  /** (Re)arm the inter-byte timeout so a silent analyzer can't hang the sender. */
  private arm(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.log?.('host-query: timed out waiting for ACK, aborting')
      this.finish()
    }, 5000)
  }

  private finish(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.state = 'done'
    const res = this.resolve
    this.resolve = undefined
    this.state = 'idle'
    res?.()
  }
}
