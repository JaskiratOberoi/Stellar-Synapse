/**
 * Getein MAGICL onboarding verification.
 *
 * Feeds a representative MAGICL-series ASTM E1394 upload (H/P/O/R/L, LIS01-A2
 * low-level framing: ENQ, STX…ETX, checksum, EOT) through Synapse's PRODUCTION
 * code path — the real AstmProtocol decoder + the catalog-built MAGICL driver
 * (generic ASTM parser) — and asserts the barcode, analyte codes, values, units
 * and flags come out correct. Also verifies bidirectional host-query (Q record →
 * SID) extraction. This is the same standard ASTM layout the SNIBE Maglumi CLIA
 * driver already uses in production; the script proves the MAGICL catalog entry
 * decodes it without a model-specific parser.
 *
 * Run:  bundle with esbuild then `node <bundled>.mjs` (see the shell one-liner in
 * the PR / commit that added this file).
 */
import { AstmProtocol } from '../src/main/core/protocols/astm'
import { extractAstmQuery } from '../src/main/core/drivers/parsing'
import { getDriver } from '../src/main/core/drivers/registry'

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
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

/** Frame one ASTM record per E1381: STX <fn> text CR ETX <C1C2> CR LF. */
function frame(fn: number, text: string): Buffer {
  const STX = 0x02, ETX = 0x03, CR = 0x0d, LF = 0x0a
  const body = `${fn}${text}\r${String.fromCharCode(ETX)}`
  let sum = 0
  for (const ch of body) sum = (sum + ch.charCodeAt(0)) % 256
  const cs = sum.toString(16).toUpperCase().padStart(2, '0')
  return Buffer.concat([Buffer.from([STX]), Buffer.from(body, 'latin1'), Buffer.from(cs, 'latin1'), Buffer.from([CR, LF])])
}
const ENQ = Buffer.from([0x05])
const EOT = Buffer.from([0x04])

const BARCODE = 'MG25073101'
// A representative MAGICL result upload: thyroid + cardiac panel for one sample.
// Standard ASTM Universal Test ID "^^^CODE^name" in R field 3; barcode in O field 3.
const records = [
  'H|\\^&|||MAGICL 6000i^SN12345|||||LIS||P|E1394-97|20260731120000',
  'P|1||PID001||Doe^John',
  `O|1|${BARCODE}||^^^TSH|R||20260731120000`,
  'R|1|^^^TSH^Thyroid Stimulating Hormone|2.35|uIU/mL|0.27 to 4.2|N||F||20260731120000',
  `O|2|${BARCODE}||^^^FT4|R||20260731120000`,
  'R|2|^^^FT4^Free Thyroxine|1.24|ng/dL|0.93 to 1.7|N||F',
  `O|3|${BARCODE}||^^^CTNI|R||20260731120000`,
  'R|3|^^^CTNI^Cardiac Troponin I|0.012|ng/mL|0 to 0.04|N||F',
  `O|4|${BARCODE}||^^^CEA|R||20260731120000`,
  'R|4|^^^CEA^Carcinoembryonic Antigen|8.90|ng/mL|0 to 5|H||F',
  'L|1|N'
]

const driver = getDriver('magicl-6000i')
ok('magicl-6000i driver is registered', !!driver)
ok('driver protocol is astm', driver?.info.protocol === 'astm')
ok('driver mode is bidirectional (host-query capable)', driver?.info.mode === 'bidirectional')

// --- decode the upload through the real E1381 decoder -----------------------
const decoder = new AstmProtocol()
const acks: number[] = []
decoder.onControl = (b) => acks.push(b)
const messages = []
messages.push(...decoder.feed(ENQ))
records.forEach((r, i) => {
  // ASTM frame numbers are a single digit that cycles 1..7,0 — never double-digit.
  const f = frame((i % 7) + 1, r)
  // split one frame mid-stream to exercise cross-chunk buffering
  if (i === 3) {
    messages.push(...decoder.feed(f.subarray(0, 9)))
    messages.push(...decoder.feed(f.subarray(9)))
  } else {
    messages.push(...decoder.feed(f))
  }
})
messages.push(...decoder.feed(EOT))

ok('sent ACKs back to analyzer (handshake)', acks.length > 0)
eq('one complete message decoded on EOT', messages.length, 1)

const results = driver!.parse(messages[0]!, 'magicl-test')
eq('parsed 4 results', results.length, 4)

const byCode = Object.fromEntries(results.map((r) => [r.analyteCode, r]))
ok('all results carry the barcode', results.every((r) => r.sampleId === BARCODE), results.map((r) => r.sampleId).join(','))
eq('TSH value', byCode['TSH']?.value, '2.35')
eq('TSH unit', byCode['TSH']?.unit, 'uIU/mL')
eq('FT4 value', byCode['FT4']?.value, '1.24')
eq('CTNI value', byCode['CTNI']?.value, '0.012')
eq('CEA value', byCode['CEA']?.value, '8.90')
eq('CEA high flag decoded', byCode['CEA']?.flag, 'H')

// --- bidirectional host-query (order download) ------------------------------
const qDecoder = new AstmProtocol()
const qMsgs = []
qMsgs.push(...qDecoder.feed(ENQ))
qMsgs.push(...qDecoder.feed(frame(1, 'H|\\^&|||MAGICL 6000i^SN12345|||||LIS||P|E1394-97|20260731120100')))
qMsgs.push(...qDecoder.feed(frame(2, `Q|1|^${BARCODE}||ALL||||||||O`)))
qMsgs.push(...qDecoder.feed(frame(3, 'L|1|N')))
qMsgs.push(...qDecoder.feed(EOT))
const query = extractAstmQuery(qMsgs[0]!)
ok('host-query Q record detected', !!query)
eq('host-query SID extracted', query?.sid, BARCODE)

console.log(`\n${failed === 0 ? '✅ PASS' : '❌ FAIL'} — ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('Failures:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
