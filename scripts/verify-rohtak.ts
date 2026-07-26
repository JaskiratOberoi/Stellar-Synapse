/**
 * End-to-end verification of the Rohtak DxC 700 AU wire-format override against
 * the REAL R/S/D frames captured in the eLab logs. Exercises the three format
 * consumers: parseAuHeader (barcode extraction for host query), parseBeckmanAu
 * (result decode), and buildAuOrderResponse (the S order response). A wrong
 * S-response makes the analyzer run the wrong assays, so the byte-exact match
 * against eLab's own S frame is the load-bearing assertion here.
 * Run: npm run verify:rohtak
 */
import { parseBeckmanAu, buildAuOrderResponse } from '../src/main/core/drivers/beckmanAu'
import { parseAuHeader, mergeAuFormat } from '../src/main/core/protocols/beckmanAu'
import type { ProtocolMessage } from '../src/main/core/drivers/IInstrumentDriver'
import rohtak from '../presets/rohtak.json'

const inst = rohtak.instruments[0]
const fmt = mergeAuFormat(inst.auFormat as Record<string, number | boolean>)
const override = (inst.onlineTestMenu as Array<{ no: number; code: string }>).map((m) => ({
  no: m.no,
  code: m.code
}))

let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

// ---- 1. Header parse: barcode extraction from a real R request -------------
// R 000801N0220                   9153004   (barcode at 32-39)
const rBlock = 'R 000801N0220                   9153004'
const rh = parseAuHeader(rBlock, fmt)
check('R header -> SID 9153004', rh.sampleId === '9153004', `got "${rh.sampleId}"`)

// ---- 2. Result decode: a real D block under the per-site table --------------
const dBlock =
  'D 001006 0187                   8851336    E20260722000759' +
  '001  3.33  009 0.335  025  6.93  002 134.5  003  17.9  028  9.45  012 0.029  005  20.2  013  12.5  029   2.5  006  9.10  024 0.238  097 135.8  098 4.186  099 102.7  '
const dh = parseAuHeader(dBlock, fmt)
check('D header -> SID 8851336', dh.sampleId === '8851336', `got "${dh.sampleId}"`)

const msg: ProtocolMessage = {
  protocol: 'beckman-au',
  raw: dBlock,
  records: [['D', dh.sampleId]]
} as ProtocolMessage
const results = parseBeckmanAu(msg, 'inst-rohtak', fmt, override)
const got = new Map(results.map((r) => [r.analyteCode, r.value]))
const EXPECT: Array<[string, string]> = [
  ['ALB', '3.33'], ['CRE', '0.335'], ['TP', '6.93'], ['ALP', '134.5'], ['ALT', '17.9'],
  ['UREA', '9.45'], ['DBIL', '0.029'], ['AST', '20.2'], ['GGT', '12.5'], ['UA', '2.5'],
  ['CA', '9.10'], ['TBIL', '0.238'], ['Na', '135.8'], ['K', '4.186'], ['Cl', '102.7']
]
check(`D decodes ${EXPECT.length} analytes`, results.length === EXPECT.length, `got ${results.length}`)
for (const [code, val] of EXPECT) {
  const g = got.get(code)
  check(`  ${code} = ${val}`, g != null && parseFloat(g) === parseFloat(val), `got ${g ?? '(missing)'}`)
}
// The whole point of the per-site table: 028 must be UREA (not the default BUN
// slot), 097/098/099 the electrolytes.
check('028->UREA, 097->Na, 099->Cl (site numbering applied)',
  got.get('UREA') === '9.45' && got.get('Na') === '135.8' && got.get('Cl') === '102.7')

// ---- 3. S order-response: byte-exact vs eLab's own S frame ------------------
// eLab answered R(9153004) with:  S 000801 0220                   9153004    E014
const expectedS = 'S 000801 0220                   9153004    E014'
const builtS = buildAuOrderResponse(rBlock, [14], fmt, { demographics: false })
check('S response byte-exact vs eLab', builtS === expectedS,
  builtS === expectedS ? '' : `\n      built:    "${builtS}"\n      expected: "${expectedS}"`)

// A multi-test order (E099009097028029098006 style) also round-trips.
const rBlock2 = 'R 000807N0226                   9143896'
const expectedS2 = 'S 000807 0226                   9143896    E099009097028029098006'
const builtS2 = buildAuOrderResponse(rBlock2, [99, 9, 97, 28, 29, 98, 6], fmt, { demographics: false })
check('S multi-test response byte-exact vs eLab', builtS2 === expectedS2,
  builtS2 === expectedS2 ? '' : `\n      built:    "${builtS2}"\n      expected: "${expectedS2}"`)

console.log('')
if (failed > 0) { console.log(`${failed} FAILURE(S)`); process.exit(1) }
console.log('ALL PASS')
