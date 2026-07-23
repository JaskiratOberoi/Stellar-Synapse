/**
 * Beckman Coulter Access / DxI host-query (order-download) response.
 *
 * The Access/DxI is a bidirectional ASTM E1394 immunoassay analyzer. When a
 * sample is loaded it sends a Q (query) record asking the LIS which tests to run
 * for a barcode; the LIS answers by initiating its own H/P/O/L transmission over
 * the E1381 ENQ/ACK handshake. Replicated from a live eLab Assist capture
 * (Karnal, 2026-07):
 *
 *   LIS -> <ENQ>                                                 ana -> <ACK>
 *   LIS -> <STX>1H|\^&||||||||||P|1<CR><ETX>cc<CR><LF>           ana -> <ACK>
 *   LIS -> <STX>2P|1|…<CR><ETX>cc<CR><LF>                        ana -> <ACK>
 *   LIS -> <STX>3O|1|<sid>||^^^c1\^^^c2\^^^c3|||||||N|…|Q<CR><ETX>cc<CR><LF>  ana -> <ACK>
 *   LIS -> <STX>4L|1<CR><ETX>cc<CR><LF>                          ana -> <ACK>
 *   LIS -> <EOT>
 *
 * Unlike the SNIBE MAGLUMI "simple" host-download, these are STANDARD E1381
 * frames: numbered, with a `<CR>` before `<ETX>` and a modulo-256 checksum over
 * `frameNumber + text + <CR> + <ETX>`. All ordered tests ride in ONE O record,
 * universal-test-ids joined by the ASTM repeat delimiter "\", and the O record's
 * report-type field is "Q" (request). The AstmHostQuerySender drives the
 * ENQ/ACK/EOT handshake around the frames this module builds.
 */

const STX = 0x02
const ETX = 0x03

/** Frame one ASTM record per standard E1381: STX FN text CR ETX C1C2 CR LF. */
function frameE1381(frameNum: number, record: string): Buffer {
  // Checksum covers frame number + text + CR + ETX (E1381 §).
  const body = `${frameNum}${record}\r${String.fromCharCode(ETX)}`
  let sum = 0
  for (let i = 0; i < body.length; i++) sum = (sum + body.charCodeAt(i)) & 0xff
  const cs = sum.toString(16).toUpperCase().padStart(2, '0')
  return Buffer.from(String.fromCharCode(STX) + body + cs + '\r\n', 'latin1')
}

/**
 * Build the ENQ/ACK-gated frames that answer a Beckman Access/DxI host query for
 * `sid` with the given analyzer test codes. Returns E1381 frames (H, P, O, L) in
 * order; the sender adds the leading ENQ, per-frame ACK waits, and trailing EOT.
 * With no codes the O record is omitted (the analyzer runs nothing for the sample).
 */
export function buildBeckmanDxiOrderFrames(sid: string, codes: readonly string[]): Buffer[] {
  const records: string[] = ['H|\\^&||||||||||P|1', 'P|1||||||||||||||||||||||||']
  if (codes.length > 0) {
    const universal = codes.map((c) => `^^^${c}`).join('\\')
    // O-3 = barcode, O-5 = tests (joined by "\"), O-12 = "N" (priority),
    // O-26 = "Q" (report type: request). Field count matches the live capture.
    records.push(`O|1|${sid}||${universal}|||||||N||||||||||||||Q`)
  }
  records.push('L|1')
  return records.map((rec, i) => frameE1381(i + 1, rec))
}
