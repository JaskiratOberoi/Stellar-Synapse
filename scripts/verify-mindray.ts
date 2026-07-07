/**
 * BS-430 <-> eLABS parity verification.
 *
 * Replays REAL frames captured from the live eLABS/ElabAssistLite BS430
 * interface (logINMessage_04072026.log) through Synapse's actual production code
 * (AstmProtocol decoder + Mindray driver) and asserts the results match what
 * eLABS itself extracted and uploaded to the LIS (logDetails_04072026.log).
 *
 * Run:  node <bundled>.mjs   (bundled from this file with esbuild)
 */
import { AstmProtocol } from '../src/main/core/protocols/astm'
import { extractAstmQuery } from '../src/main/core/drivers/parsing'
import {
  MINDRAY_BS_CHEM,
  buildMindrayAstmSample,
  buildMindrayOrderRecords,
  frameMindrayMessage,
  parseMindrayAstm
} from '../src/main/core/drivers/mindray'
import { getDriver } from '../src/main/core/drivers/registry'

let passed = 0
let failed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
    console.log(`  \u2713 ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

/** Convert the log's printable control tokens into real wire bytes. */
function wire(printable: string): Buffer {
  const map: Record<string, number> = {
    ENQ: 0x05,
    STX: 0x02,
    ETX: 0x03,
    EOT: 0x04,
    ACK: 0x06,
    CR: 0x0d,
    LF: 0x0a
  }
  const out = printable.replace(/\[(ENQ|STX|ETX|EOT|ACK|CR|LF)\]/g, (_, t: string) =>
    String.fromCharCode(map[t])
  )
  return Buffer.from(out, 'latin1')
}

/** Feed a full analyzer transmission (ENQ..frame..EOT) and return the one message. */
function decodeOne(printableFrame: string) {
  const proto = new AstmProtocol()
  const msgs = proto.feed(wire(`[ENQ]${printableFrame}[EOT]`))
  if (msgs.length !== 1) throw new Error(`expected 1 message, got ${msgs.length}`)
  return msgs[0]
}

const INSTR = 'test-bs430'

// =============================================================================
console.log('\n[1] Host-query parsing (analyzer RQ -> extract barcode)')
// Real query frames (logINMessage lines 2, 5, 138 leading-zero position).
{
  const q1 = decodeOne(
    '[STX]1H|\\^&|||Mindry^^|||||||RQ|1394-97|20260704000642[CR]Q|221|^8454133||||||||||O[CR]L|87|N[CR][ETX]A0[CR][LF]'
  )
  eq('query SID 8454133', extractAstmQuery(q1)?.sid, '8454133')

  const q2 = decodeOne(
    '[STX]1H|\\^&|||Mindry^^|||||||RQ|1394-97|20260704000712[CR]Q|222|^8766091||||||||||O[CR]L|88|N[CR][ETX]A9[CR][LF]'
  )
  eq('query SID 8766091', extractAstmQuery(q2)?.sid, '8766091')

  const q3 = decodeOne(
    '[STX]1H|\\^&|||Mindry^^|||||||RQ|1394-97|20260704043249[CR]Q|239|^8903916||||||||||O[CR]L|114|N[CR][ETX]E2[CR][LF]'
  )
  eq('query SID 8903916', extractAstmQuery(q3)?.sid, '8903916')
}

// =============================================================================
console.log('\n[2] Result parsing vs eLABS LIS uploads (sample 8766097)')
// Frame: logINMessage line 66.  Ground truth: logDetails lines 237-245.
{
  const frame =
    '[STX]1H|\\^&|||Mindry^^|||||||PR|1394-97|20260704001046[CR]' +
    'P|796||PATIENT111||ABC^^||19600315^66^Y|M||||||||||||||||||||||||||[CR]' +
    'O|796|9058^1^11|8766097|SGOT^Aspartate Aminotransferase^^\\TP^Total Protein^^\\BIT^T.BILL H^^\\SGPT^SGPT^^\\ALB^ALBUMIN ^^\\ALP^ALKALINE ^^|R|20260703235833|20260703235833|||||||20260703235833|serum||||||||||F|||||[CR]' +
    'R|241|SGOT^Aspartate Aminotransferase^^F|67.983848^^^^|U/L|^|N||F|67.983848^^^^|0|20260704000931||Mindry^[CR]' +
    'R|242|TP^Total Protein^^F|8.196338^^^^|g/dL|^|N||F|8.196338^^^^|0|20260704000956||Mindry^[CR]' +
    'R|243|BIT^T.BILL H^^F|0.629419^^^^|mg/dL|^|N||F|0.629419^^^^|0|20260704001005||Mindry^[CR]' +
    'R|244|SGPT^SGPT^^F|72.999741^^^^|U/L|^|N||F|72.999741^^^^|0|20260704000956||Mindry^[CR]' +
    'R|245|ALB^ALBUMIN ^^F|4.302177^^^^|g/dL|^|N||F|4.302177^^^^|0|20260704000532||Mindry^[CR]' +
    'R|246|ALP^ALKALINE ^^F|90.648357^^^^|U/L|^|N||F|90.648357^^^^|0|20260704001013||Mindry^[CR]' +
    'L|100|N[CR][ETX]A2[CR][LF]'
  const results = parseMindrayAstm(decodeOne(frame), INSTR)
  const by = Object.fromEntries(results.map((r) => [r.analyteCode, r]))

  ok('all 6 results filed under barcode 8766097', results.every((r) => r.sampleId === '8766097'))
  eq('count = 6', results.length, 6)
  // eLABS logDetails: SGOT 67.98, TP 8.2, BIT 0.63, SGPT 73, ALB 4.3, ALP 90.65
  eq('SGOT value', by['SGOT']?.value, '67.98')
  eq('TP value', by['TP']?.value, '8.2')
  eq('BIT value', by['BIT']?.value, '0.63')
  eq('SGPT value', by['SGPT']?.value, '73')
  eq('ALB value', by['ALB']?.value, '4.3')
  eq('ALP value', by['ALP']?.value, '90.65')
  eq('SGOT unit', by['SGOT']?.unit, 'U/L')
  eq('TP unit', by['TP']?.unit, 'g/dL')
  eq('SGOT name (component 2)', by['SGOT']?.analyteName, 'Aspartate Aminotransferase')
  eq('SGOT flag', by['SGOT']?.flag, 'N')
}

// =============================================================================
console.log('\n[3] Result parsing vs eLABS LIS uploads (sample 8453580, 14 tests)')
// Frame: logINMessage line 69.  Ground truth: logDetails lines 270-287.
{
  const frame =
    '[STX]1H|\\^&|||Mindry^^|||||||PR|1394-97|20260704001222[CR]' +
    'P|797||PATIENT111||ABC^^||19600315^66^Y|M||||||||||||||||||||||||||[CR]' +
    'O|797|9059^1^12|8453580|X|R|20260703235834|20260704001044|||||||20260703235834|serum||||||||||F|||||[CR]' +
    'R|247|SGOT^Aspartate Aminotransferase^^F|27.769323^^^^|U/L|^|N||F|27.769323^^^^|0|20260704001022||Mindry^[CR]' +
    'R|248|TP^Total Protein^^F|7.912913^^^^|g/dL|^|N||F|7.912913^^^^|0|20260704001048||Mindry^[CR]' +
    'R|249|CREAT^CRE R^^F|0.503518^^^^|mg/dL|^|N||F|0.503518^^^^|0|20260704000939||Mindry^[CR]' +
    'R|250|BIT^T.BILL H^^F|0.294193^^^^|mg/dL|^|N||F|0.294193^^^^|0|20260704001113||Mindry^[CR]' +
    'R|251|CHOL^T.CHOL^^F|135.666803^^^^|mg/dL|^|N||F|135.666803^^^^|0|20260704000632||Mindry^[CR]' +
    'R|252|SGPT^SGPT^^F|9.043334^^^^|U/L|^|N||F|9.043334^^^^|0|20260704001113||Mindry^[CR]' +
    'R|253|ALB^ALBUMIN ^^F|3.832383^^^^|g/dL|^|N||F|3.832383^^^^|0|20260704000649||Mindry^[CR]' +
    'R|254|ALP^ALKALINE ^^F|58.359687^^^^|U/L|^|N||F|58.359687^^^^|0|20260704001130||Mindry^[CR]' +
    'R|255|URIC^URIC ACID^^F|1.391995^^^^|mg/dL|^|N||F|1.391995^^^^|0|20260704000558||Mindry^[CR]' +
    'R|256|TRIG^TG H^^F|144.128786^^^^|mg/dL|^|N||F|144.128786^^^^|0|20260704001205||Mindry^[CR]' +
    'R|257|GGT^GGT H^^F|10.684250^^^^|U/L|^|N||F|10.684250^^^^|0|20260704001156||Mindry^[CR]' +
    'R|258|BID^D.BIL H^^F|0.362923^^^^|mg/dL|^|N||F|0.362923^^^^|0|20260704001222||Mindry^[CR]' +
    'R|259|CAL^CA. SB^^F|-0.412399^^^^|mg/dL|^|N||F|-0.412399^^^^|0|20260704000741||Mindry^[CR]' +
    'R|260|UREA^UREA^^F|0.707241^^^^|mg/dL|^|N||F|0.707241^^^^|0|20260704001130||Mindry^[CR]' +
    'L|101|N[CR][ETX]C7[CR][LF]'
  const results = parseMindrayAstm(decodeOne(frame), INSTR)
  const by = Object.fromEntries(results.map((r) => [r.analyteCode, r]))

  eq('count = 14', results.length, 14)
  ok('all filed under 8453580', results.every((r) => r.sampleId === '8453580'))
  // eLABS ground truth (rounded to 2 dp):
  eq('ALP 58.36', by['ALP']?.value, '58.36')
  eq('CREAT 0.5', by['CREAT']?.value, '0.5')
  eq('ALB 3.83', by['ALB']?.value, '3.83')
  eq('TP 7.91', by['TP']?.value, '7.91')
  eq('BIT 0.29', by['BIT']?.value, '0.29')
  eq('BID 0.36', by['BID']?.value, '0.36')
  eq('UREA 0.71', by['UREA']?.value, '0.71')
  eq('GGT 10.68', by['GGT']?.value, '10.68')
  eq('SGOT 27.77', by['SGOT']?.value, '27.77')
  eq('SGPT 9.04', by['SGPT']?.value, '9.04')
  eq('URIC 1.39', by['URIC']?.value, '1.39')
  eq('TRIG 144.13', by['TRIG']?.value, '144.13')
  eq('CHOL 135.67', by['CHOL']?.value, '135.67')
  // CAL is negative; eLABS logged it raw (-0.412399) — a known eLABS quirk.
  // Synapse rounds consistently to -0.41 (the correct 2-dp value).
  eq('CAL -0.41 (consistent rounding; eLABS logged -0.412399 raw)', by['CAL']?.value, '-0.41')
}

// =============================================================================
console.log('\n[4] Edge cases: leading-zero barcode, empty patient, negative')
{
  // logINMessage line 94: O has SID in field 4 with a leading zero; empty patient.
  const frame =
    '[STX]1H|\\^&|||Mindry^^|||||||PR|1394-97|20260704005014[CR]' +
    'P|800||||^^||^^|U||||||||||||||||||||||||||[CR]' +
    'O|800|1^1^1|08454131|GLU^GLU H^^|R|20260704002432|20260704002424|||||||20260704002424|serum||||||||||F|||||[CR]' +
    'R|281|GLU^GLU H^^F|126.198530^^^^|mg/dL|^|N||F|126.198530^^^^|0|20260704005014||Mindry^[CR]' +
    'L|106|N[CR][ETX]15[CR][LF]'
  const results = parseMindrayAstm(decodeOne(frame), INSTR)
  eq('leading-zero barcode preserved', results[0]?.sampleId, '08454131')
  eq('GLU rounded 126.2', results[0]?.value, '126.2')
  eq('GLU unit mg/dL', results[0]?.unit, 'mg/dL')
}

// =============================================================================
console.log('\n[5] Order download build + framing (answer a host query)')
{
  // For sample 8766092 the eLABS SA order carried exactly these 8 tests
  // (logINMessage line 31). Confirm our builder reproduces the O record field 5.
  const codes = ['HDL', 'LDL', 'TIBC', 'ALB', 'TP', 'UIBC', 'BID', 'BIT']
  const recs = buildMindrayOrderRecords('8766092', codes)
  const [h, p, o, l] = recs
  eq('H record type = SA', h[11], 'SA')
  eq('P record present', p[0], 'P')
  eq('O barcode in field 4 (index 3)', o[3], '8766092')
  eq(
    'O test list = eLABS encoding',
    o[4],
    'HDL^^2^1\\LDL^^2^1\\TIBC^^2^1\\ALB^^2^1\\TP^^2^1\\UIBC^^2^1\\BID^^2^1\\BIT^^2^1'
  )
  eq('L terminator', l[0], 'L')

  const frames = frameMindrayMessage(recs)
  eq('single E1381 frame', frames.length, 1)
  const buf = frames[0]
  ok('frame starts with STX', buf[0] === 0x02)
  ok('frame ends with CRLF', buf[buf.length - 2] === 0x0d && buf[buf.length - 1] === 0x0a)
  // Recompute the checksum the way the analyzer does and compare to the frame's.
  const s = buf.toString('latin1')
  const etxIdx = s.indexOf('\x03')
  const body = s.slice(1, etxIdx + 1) // frameNum..records..CR..ETX (after STX)
  let sum = 0
  for (let i = 0; i < body.length; i++) sum = (sum + body.charCodeAt(i)) & 0xff
  const expectedCs = sum.toString(16).toUpperCase().padStart(2, '0')
  const actualCs = s.slice(etxIdx + 1, etxIdx + 3)
  eq('checksum valid', actualCs, expectedCs)
  ok('CR precedes ETX (BS-430 framing)', s[etxIdx - 1] === '\r')
}

// =============================================================================
console.log('\n[6] Round-trip: simulator frame -> decoder -> parser')
{
  const sample = buildMindrayAstmSample('S123456', 'Mindray BS-430', MINDRAY_BS_CHEM.slice(0, 6))
  const proto = new AstmProtocol()
  const msgs = proto.feed(wire(`[ENQ][STX]1${sample.replace(/\r/g, '[CR]')}[CR][ETX]00[CR][LF][EOT]`))
  const results = parseMindrayAstm(msgs[0], INSTR)
  eq('round-trip result count = 6', results.length, 6)
  ok('round-trip barcode', results.every((r) => r.sampleId === 'S123456'))
  ok(
    'round-trip codes preserved',
    ['GLU', 'UREA', 'CREAT', 'URIC', 'BIT', 'BID'].every((c) => results.some((r) => r.analyteCode === c))
  )
}

// =============================================================================
console.log('\n[7] Driver registration + dialect wiring')
{
  const d = getDriver('mindray-bs-430')
  ok('BS-430 driver registered', !!d)
  eq('astmDialect = mindray', d?.astmDialect, 'mindray')
  eq('protocol = astm', d?.info.protocol, 'astm')
  eq('mode = bidirectional', d?.info.mode, 'bidirectional')
  ok('driver.parse routes to Mindray dialect', (() => {
    const msg = decodeOne(
      '[STX]1H|\\^&|||Mindry^^|||||||PR|1394-97|20260704005014[CR]' +
        'O|800|1^1^1|77777|GLU^GLU H^^|R[CR]' +
        'R|281|GLU^GLU H^^F|100.5^^^^|mg/dL|^|N||F[CR]L|1|N[CR][ETX]00[CR][LF]'
    )
    const r = d!.parse(msg, INSTR)
    return r.length === 1 && r[0].sampleId === '77777' && r[0].value === '100.5'
  })())
}

// =============================================================================
console.log('\n' + '='.repeat(64))
console.log(`RESULT: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFAILURES:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All BS-430 <-> eLABS parity checks passed.')
