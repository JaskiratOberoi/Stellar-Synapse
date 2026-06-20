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
const ETB = 0x17
const NAK = 0x15

/** ASTM timestamp YYYYMMDDHHMMSS. */
function ts(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`
}

/**
 * Build the ASTM order records that answer a host query for `sid` with the given
 * instrument analyte codes. Returns logical records (the framer adds E1381
 * framing). One O record per ordered test; the analyzer reads `^^^<code>`.
 */
export function buildAstmOrderRecords(
  sid: string,
  analyteCodes: string[],
  analyzerName: string,
  hostName = 'Lis'
): string[][] {
  const records: string[][] = []
  // Header must match SNIBE's documented host->analyzer layout exactly, AND echo
  // the analyzer's own Analyzer ID (field 5) / Host ID (field 10) from its query
  // header — the X3 validates these and silently drops the assay on a mismatch:
  //   H|\^&||PSWD|<analyzerId>|||||<hostId>||P|E1394-97|<ts>
  records.push(['H', '\\^&', '', 'PSWD', analyzerName, '', '', '', '', hostName, '', 'P', 'E1394-97', ts()])
  records.push(['P', '1'])
  analyteCodes.forEach((code, i) => {
    // EXACT SNIBE Chapter 16 order-download format (p.16-8): one O record per
    // test, each ending in the priority field "R":  O|seq|sid||^^^<channel>|R
    //
    // History: "|R" was removed earlier after a single-test order failed with it
    // — but that test was contaminated (the channel name was also wrong then,
    // "VITB12" vs "Vit B12 III"), so the failure was the channel, not "|R".
    // Restored to match the manual now that channel names are correct.
    records.push(['O', String(i + 1), sid, '', `^^^${code}`, 'R'])
  })
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
 * (1-7, rolling to 0). Use for the MAGLUMI X3 multi-test order-download: the X3
 * reads only one order (O) record per frame, so every record must arrive in its
 * own frame within the single response session.
 *
 * Per E1381, INTERMEDIATE frames terminate with ETB (0x17) and only the FINAL
 * frame with ETX (0x03); the checksum covers frameNum + record + terminator.
 */
export function frameAstmPerRecord(records: string[][]): Buffer[] {
  const lastIdx = records.length - 1
  return records.map((rec, i) => {
    const frameNum = (i + 1) % 8 // 1,2,…,7,0,1,…
    const term = i === lastIdx ? ETX : ETB
    const body = `${frameNum}${rec.join('|')}${String.fromCharCode(term)}`
    let sum = 0
    for (let k = 0; k < body.length; k++) sum = (sum + body.charCodeAt(k)) & 0xff
    const cs = sum.toString(16).toUpperCase().padStart(2, '0')
    return Buffer.from(String.fromCharCode(STX) + body + cs + '\r\n', 'latin1')
  })
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
    this.frames = perRecord ? frameAstmPerRecord(records) : [frameAstmMessage(records)]
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
