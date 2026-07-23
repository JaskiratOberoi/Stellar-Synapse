import type { ProtocolMessage } from '../protocols/IProtocol'
import { Hl7Protocol } from '../protocols/hl7'

/**
 * Getein MAGICL / Metis HL7 host-query (order-download) + result acknowledgment.
 *
 * The MAGICL 6000i is a TCP server; Synapse dials in as a client. When a sample
 * is loaded the analyzer sends an HL7 `QRY^Q02` asking which tests to run for a
 * barcode (barcode in QRD-8). The host answers with a `QCK^Q02` acknowledgment
 * and a `DSR^Q03` display response carrying the ordered assay item-ids in DSP
 * segments. The analyzer also expects an `ACK^R01` after each `ORU^R01` upload.
 *
 * The QCK/DSR are replicated BYTE-FOR-BYTE from a live eLab Assist capture
 * (Karnal): a FLATTENED HL7 stream (segments run together, NOT CR-delimited),
 * MSH..UTF8|||MSA|AA|<ctrl>|Message accepted|||0|ERR|0|QAK|SR|OK, the query's
 * QRD/QRF echoed, then DSP|1..28 (each `DSP|n|||||`) with the barcode at DSP-21,
 * priority "N" at DSP-24, sample type at DSP-26 and one ordered code per DSP from
 * DSP-29 (`<code>^^^`), ending `DSC||`. Getein's own parser is strict about this
 * exact shape — a missing ERR segment or trailing field makes it reject the whole
 * order ("Failed to obtain the task"), so this must not be "cleaned up".
 */

export interface GeteinQuery {
  /** Sample barcode from QRD-8. */
  sid: string
  /** MSH-10 message control id of the query (echoed in MSA-2 of the ack). */
  controlId: string
  /** QRD-1 (query date/time) — echoed verbatim in the DSR's QRD. */
  qrdDateTime: string
  /** QRD-4 (query id) — echoed verbatim in the DSR's QRD. */
  queryId: string
}

/** MSH is special: after split on '|', element[N-1] is field MSH-N (N>=2). */
function mshField(message: ProtocolMessage, fieldNo: number): string {
  const msh = message.records.find((r) => (r[0] || '').toUpperCase() === 'MSH')
  return (msh?.[fieldNo - 1] || '').trim()
}

function messageType(message: ProtocolMessage): string {
  return mshField(message, 9).toUpperCase()
}

function controlId(message: ProtocolMessage): string {
  return mshField(message, 10) || '0'
}

/** HL7 timestamp YYYYMMDDHHMMSS (local). */
function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** Recognize a `QRY^Q02` order query and pull its barcode + echo fields, else null. */
export function parseGeteinQuery(message: ProtocolMessage): GeteinQuery | null {
  if (message.protocol !== 'hl7') return null
  if (!messageType(message).startsWith('QRY')) return null
  const qrd = message.records.find((r) => (r[0] || '').toUpperCase() === 'QRD')
  // QRD-8 (Who Subject Filter) = the queried sample barcode.
  const sid = (qrd?.[8] || '').split('^')[0].trim()
  if (!sid) return null
  return {
    sid,
    controlId: controlId(message),
    qrdDateTime: (qrd?.[1] || '').trim(),
    queryId: (qrd?.[4] || '').trim()
  }
}

/** If the message is an `ORU^R01` result upload, return its control id for the ACK. */
export function geteinResultControlId(message: ProtocolMessage): string | null {
  if (message.protocol !== 'hl7') return null
  return messageType(message).startsWith('ORU') ? controlId(message) : null
}

/** Common MSH..QAK|SR|OK preamble shared by QCK and DSR (flattened, with ERR|0). */
function preamble(msgType: string, msgCtrl: string, queryCtrl: string): string {
  return (
    `MSH|^~\\&|||||${stamp()}||${msgType}|${msgCtrl}|P|2.3.1||||||UTF8|||` +
    `MSA|AA|${queryCtrl}|Message accepted|||0|ERR|0|QAK|SR|OK`
  )
}

/** Query acknowledgment (`QCK^Q02`) referencing the query's control id. */
export function buildGeteinQck(queryControlId: string): string {
  return preamble('QCK^Q02', '1001', queryControlId)
}

/**
 * Data-response (`DSR^Q03`) listing the ordered assay item-ids for a barcode,
 * byte-matching the live eLab layout (see file header). Empty code set => the DSP
 * list stops at 28 (analyzer runs nothing).
 */
export function buildGeteinDsr(
  query: GeteinQuery,
  codes: readonly string[],
  opts?: { sampleType?: string }
): string {
  const sampleType = opts?.sampleType ?? 'serum'
  const qrd = `QRD|${query.qrdDateTime}|R|D|${query.queryId}|||RD|${query.sid}|OTH|||T`
  const qrf = 'QRF||||||RCT|COR|ALL'
  let dsp = ''
  const total = 28 + codes.length
  for (let n = 1; n <= total; n++) {
    if (n === 21) dsp += `DSP|${n}||${query.sid}|||`
    else if (n === 24) dsp += `DSP|${n}||N|||`
    else if (n === 26) dsp += `DSP|${n}||${sampleType}|||`
    else if (n >= 29) dsp += `DSP|${n}||${codes[n - 29]}^^^|||`
    else dsp += `DSP|${n}|||||`
  }
  return `${preamble('DSR^Q03', '1002', query.controlId)}|${qrd}|${qrf}||${dsp}DSC||`
}

/** Result acknowledgment (`ACK^R01`) echoing the upload's control id. */
export function buildGeteinAck(oruControlId: string): string {
  return (
    `MSH|^~\\&|||||${stamp()}||ACK^R01|${oruControlId}|P|2.3.1||||||UTF8|||` +
    `MSA|AA|${oruControlId}|Message Accepted|||0`
  )
}

/** Wrap an HL7 message body in MLLP framing for transmission to the analyzer. */
export function frameGeteinHl7(body: string): Buffer {
  return Hl7Protocol.frame(body)
}
