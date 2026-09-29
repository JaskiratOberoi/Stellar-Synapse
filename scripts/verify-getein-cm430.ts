/**
 * Getein CM-430 <-> "HL7 Communication Protocol - CM series" parity checks.
 *
 * Replays every worked example printed in Getein's CM-series protocol document
 * (§2.4.1 result upload + ACK, §2.4.2 barcode / sample-no / time-range queries,
 * QCK^Q02 and DSR^Q03) through Synapse's production code: the MLLP decoder, the
 * getein HL7 parser, the host-query builders and the spec-exact result ACK.
 * No live CM-430 capture exists yet; when one does, add its raw frames here.
 *
 * Run:  npm run verify:getein-cm430
 */
import { Hl7Protocol } from '../src/main/core/protocols/hl7'
import { parseGeteinHl7 } from '../src/main/core/drivers/getein'
import {
  buildGeteinAck,
  buildGeteinDsr,
  buildGeteinQck,
  buildGeteinSpecAck,
  frameGeteinHl7,
  geteinResultClass,
  geteinResultControlId,
  parseGeteinQuery
} from '../src/main/core/drivers/geteinHostQuery'
import { getDriver } from '../src/main/core/drivers/registry'
import { fingerprintInstrument } from '../src/main/core/discovery/fingerprint'
import { listPresets } from '../src/main/core/presets/registry'

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`)
  }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

const VT = '\x0b'
const FS = '\x1c'
const CR = '\r'
/** <SB>segments<EB><CR>, each segment CR-terminated, as the document prints it. */
const mllp = (segs: string[]): Buffer => Buffer.from(VT + segs.join(CR) + CR + FS + CR, 'latin1')
const decode = (segs: string[]) => {
  const msgs = new Hl7Protocol().feed(mllp(segs))
  if (msgs.length !== 1) throw new Error(`expected 1 decoded message, got ${msgs.length}`)
  return msgs[0]
}
/** Replace every 14-digit HL7 timestamp so built messages compare to the document. */
const noTs = (s: string): string => s.replace(/\b\d{14}\b/g, 'TS')

// §2.4.1.1 — patient result upload (the document wraps the OBR over two lines; joined here).
const ORU = [
  'MSH|^~\\&|||||20120508094822||ORU^R01|1|P|2.3.1||||0||UTF8|||',
  'PID|1|1001||| Mike ||19851001095133|M|||||||||||||||||||||||',
  'OBR|1|12345678|10|^|Y|20120405193926|20120405193914|20120405193914||||||20120405193914|serum|||||||||||||||||||||||||||||||||',
  'OBX|1|NM|2|TBil|100| umol/L |-|N|||F||100|20120405194245|||0|',
  'OBX|2|NM|5|ALT|98.2| umol/L |-|N|||F||98.2|20120405194403|||0|',
  'OBX|3|NM|6|AST|26.4| umol/L |-|N|||F||26.4|||||'
]
// §2.4.1.2 — QC upload (MSH-16 = 2).
const QC = [
  'MSH|^~\\&|||||20120508103014||ORU^R01|1|P|2.3.1||||2||UTF8|||',
  'OBR|1|7|AST|^|||20120405141255||||2|1^2|QUAL1^QUAL2|1111^2222|20300101^20300101||L^M|45.000000^55.000000|5.000000^5.000000|0.130291^0.137470||||||||||||||||||||||||||||'
]
// §2.4.2.1 / .2 / .3 — the three query modes.
const QRY_BARCODE = [
  'MSH|^~\\&|||||20120508104700||QRY^Q02|4|P|2.3.1||||||UTF8|||',
  'QRD|20120508104700|R|D|1|||RD|0019|OTH|||T|',
  'QRF||||||RCT|COR|ALL||'
]
const QRY_SAMPLENO = [
  'MSH|^~\\&|||||20120508115221||QRY^Q02|6|P|2.3.1||||||UTF8|||',
  'QRD|20120508115221|R|D|3|||RD||OTH|||T|',
  'QRF||||1|9|RCT|COR|ALL||'
]
const QRY_TIME = [
  'MSH|^~\\&|||||20120508150259||QRY^Q02|7|P|2.3.1||||||UTF8|||',
  'QRD|20120508150259|R|D|4|||RD||OTH|||T|',
  'QRF||20120508100000|20120508150000|||RCT|COR|ALL||'
]

// =============================================================================
console.log('\n[1] Catalog: getein-cm-430 rides the getein HL7 path with the spec ACK')
{
  const cm = getDriver('getein-cm-430')
  ok('driver exists', !!cm)
  if (cm) {
    eq('protocol hl7', cm.info.protocol, 'hl7')
    eq('hl7Dialect getein', cm.hl7Dialect, 'getein')
    eq('geteinAck spec', cm.geteinAck, 'spec')
    eq('bidirectional', cm.info.mode, 'bidirectional')
    eq('default port 9108', cm.info.defaultPort, 9108)
    eq('category chemistry', cm.info.category, 'Clinical Chemistry')
    eq('maturity beta', cm.info.maturity, 'beta')
    ok('geteinAck not leaked into info', !('geteinAck' in (cm.info as object)))
  }
  eq('CM-400 sibling registered', getDriver('getein-cm-400')?.hl7Dialect, 'getein')
  eq('MAGICL 6000i keeps the run-on ACK', getDriver('magicl-6000i')?.geteinAck, undefined)
  eq('Metis keeps the run-on ACK', getDriver('getein-metis-6000')?.geteinAck, undefined)
}

// =============================================================================
console.log('\n[2] §2.4.1.1 result upload decodes: barcode OBR-2, channel No. OBX-3')
{
  const msg = decode(ORU)
  const res = parseGeteinHl7(msg, 'cm')
  eq('three results', res.length, 3)
  ok('barcode from OBR-2, not the sample No. in OBR-3', res.every((r) => r.sampleId === '12345678'))
  eq('  result 1 channel', res[0]?.analyteCode, '2')
  eq('  result 1 name', res[0]?.analyteName, 'TBil')
  eq('  result 1 value', res[0]?.value, '100')
  eq('  result 1 unit (padding trimmed)', res[0]?.unit, 'umol/L')
  eq('  "-" reference range dropped', res[0]?.referenceRange, undefined)
  eq('  flag N', res[0]?.flag, 'N')
  eq('  measured at OBX-14', res[0]?.measuredAt, '20120405194245')
  eq('  result 2 = ALT 98.2 on channel 5', `${res[1]?.analyteCode}:${res[1]?.analyteName}:${res[1]?.value}`, '5:ALT:98.2')
  eq('  result 3 = AST 26.4 on channel 6', `${res[2]?.analyteCode}:${res[2]?.analyteName}:${res[2]?.value}`, '6:AST:26.4')
  eq('  result 3 has no OBX-14', res[2]?.measuredAt, undefined)
  eq('driver.parse gives the same three', getDriver('getein-cm-430')?.parse(msg, 'cm').length, 3)
  eq('ORU control id for the ACK', geteinResultControlId(msg), '1')
  eq('ORU result class', geteinResultClass(msg), '0')
}

// =============================================================================
console.log('\n[3] §2.4.1.2 QC upload is recognised and not posted')
{
  const msg = decode(QC)
  eq('QC result class 2', geteinResultClass(msg), '2')
  eq('no patient results from a QC upload', parseGeteinHl7(msg, 'cm').length, 0)
}

// =============================================================================
console.log('\n[4] Result ACK is byte-identical to the document')
{
  const docAck = 'MSH|^~\\&|||||20120508094823||ACK^R01|1|P|2.3.1||||0||UTF8|||' + CR + 'MSA|AA|1|Message accepted|||0|' + CR
  eq('patient ACK (MSH-16 0)', noTs(buildGeteinSpecAck('1', '0')), noTs(docAck))
  const docQcAck = 'MSH|^~\\&|||||20120508094823||ACK^R01|1|P|2.3.1||||2||UTF8|||' + CR + 'MSA|AA|1|Message accepted|||0|' + CR
  eq('QC ACK echoes MSH-16 2', noTs(buildGeteinSpecAck('1', geteinResultClass(decode(QC)))), noTs(docQcAck))
  const framed = frameGeteinHl7(buildGeteinSpecAck('1'))
  eq('framed with <VT>', framed[0], 0x0b)
  eq('ends <CR><FS><CR>', framed.subarray(framed.length - 3).toString('hex'), '0d1c0d')
  // The ACK must round-trip through Synapse's own decoder as two segments.
  const back = new Hl7Protocol().feed(framed)[0]
  eq('ACK decodes to MSH + MSA', back?.records.map((r) => r[0]).join(','), 'MSH,MSA')
  // Regression guard: the MAGICL's legacy ACK is untouched.
  ok('legacy MAGICL ACK unchanged (run-on, "Message Accepted")', buildGeteinAck('9').includes('UTF8|||MSA|AA|9|Message Accepted|||0'))
}

// =============================================================================
console.log('\n[5] §2.4.2.1 barcode query -> QCK^Q02 + DSR^Q03 as the document prints them')
{
  const q = parseGeteinQuery(decode(QRY_BARCODE))
  ok('query recognised', !!q)
  if (q) {
    eq('barcode from QRD-8', q.sid, '0019')
    eq('control id', q.controlId, '4')
    eq('query id', q.queryId, '1')
    eq('query time echoed', q.qrdDateTime, '20120508104700')
    const qck = buildGeteinQck(q.controlId).split(CR)
    eq('QCK MSA', qck[1], 'MSA|AA|4|Message accepted|||0|')
    eq('QCK ERR', qck[2], 'ERR|0|')
    eq('QCK QAK', qck[3], 'QAK|SR|OK|')
    ok('QCK type', qck[0].includes('||QCK^Q02|'))
    const dsr = buildGeteinDsr(q, ['1', '2', '5']).split(CR).filter(Boolean)
    ok('DSR type', dsr[0].includes('||DSR^Q03|'))
    eq('DSR MSA echoes the query id', dsr[1], 'MSA|AA|4|Message accepted|||0|')
    eq('DSR QRF as printed', dsr.find((s) => s.startsWith('QRF')), 'QRF||||||RCT|COR|ALL||')
    for (const line of ['DSP|21||0019|||', 'DSP|24||N|||', 'DSP|26||serum|||', 'DSP|29||1^^^|||', 'DSP|30||2^^^|||', 'DSP|31||5^^^|||'])
      ok(`  carries ${line}`, dsr.includes(line))
    ok('  no DSP beyond the last ordered channel', !dsr.some((s) => s.startsWith('DSP|32|')))
    eq('  ends DSC|| (last sample)', dsr[dsr.length - 1], 'DSC||')
    eq('  DSP segments are 1..31 in order', dsr.filter((s) => s.startsWith('DSP|')).map((s) => s.split('|')[1]).join(','), Array.from({ length: 31 }, (_, i) => String(i + 1)).join(','))
  }
}

// =============================================================================
console.log('\n[6] Batch query modes carry no barcode and are not answered')
{
  eq('§2.4.2.2 sample-No. range query -> no barcode', parseGeteinQuery(decode(QRY_SAMPLENO)), null)
  eq('§2.4.2.3 time-range query -> no barcode', parseGeteinQuery(decode(QRY_TIME)), null)
}

// =============================================================================
console.log('\n[7] Discovery')
{
  eq('MSH-4 "CM430" -> getein-cm-430', fingerprintInstrument('MSH|^~\\&|GP|CM430|||20260929101010||ORU^R01|1|P|2.3.1||||0||UTF8|||' + CR)?.driverId, 'getein-cm-430')
  eq('MSH-4 "CM-400" -> getein-cm-400', fingerprintInstrument('MSH|^~\\&|GP|CM-400|||20260929101010||ORU^R01|1|P|2.3.1||||0||UTF8|||' + CR)?.driverId, 'getein-cm-400')
  eq('MAGICL6800 header still -> magicl-6800', fingerprintInstrument('MSH|^~\\&|MAGICL6800|GP|||20361231235941||ORU^R01|2|P|2.3.1||||||UTF8' + CR)?.driverId, 'magicl-6800')
}

// =============================================================================
console.log('\n[8] Rohtak preset offers the CM-430 without disturbing its other analyzers')
{
  const rohtak = listPresets().find((p) => p.preset === 'rohtak')
  ok('Rohtak preset loads', !!rohtak)
  const cm = rohtak?.instruments.find((i) => i.driverId === 'getein-cm-430')
  ok('Rohtak carries a getein-cm-430 entry', !!cm)
  eq('  transport tcp-server', cm?.transport, 'tcp-server')
  eq('  port 9108', cm?.port, 9108)
  eq('  no mappings until the channel list is captured', cm?.mappings, undefined)
  eq(
    'Rohtak still carries the DxC 700 AU and both MAGICLs',
    rohtak?.instruments
      .map((i) => i.driverId)
      .filter((d) => d !== 'getein-cm-430')
      .join(','),
    'beckman-dxc-700-au,magicl-6200,magicl-6000i'
  )
}

// =============================================================================
console.log('\n' + '='.repeat(64))
console.log(`RESULT: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFAILURES:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All Getein CM-430 <-> protocol document checks passed.')
