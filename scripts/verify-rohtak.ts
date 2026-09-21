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
// Live 2026-08-18 request (20-char sample-ID field, the analyzer's current
// Online format). The July eLab requests used a 26-char field; header parsing
// follows the CURRENT format, while buildAuOrderResponse echoes whatever width
// arrives, which is why the eLab byte-exact checks below still hold.
const rLiveBlock = 'R 000301N0095             9501268'
const rh = parseAuHeader(rLiveBlock, fmt)
check('R header -> SID 9501268', rh.sampleId === '9501268', `got "${rh.sampleId}"`)
const rBlock = 'R 000801N0220                   9153004' // July eLab frame (S-echo tests)

// ---- 2. Result decode -------------------------------------------------------
// The REAL frame captured live on 2026-08-18 (log: [host-query] RX 92B). The
// analyzer's Online format changed since July — sampleId 26 -> 20, dummy 19 ->
// 46 — so the old widths put the result groups at the wrong offset and NOTHING
// decoded. Pin the real bytes so a future drift is caught here, not in the lab.
const dReal =
  'D 000305 0081             9281305    E0                          20260818161505014  78.8  '
const dRealH = parseAuHeader(dReal, fmt)
check('live D header -> SID 9281305', dRealH.sampleId === '9281305', `got "${dRealH.sampleId}"`)
const realMsg: ProtocolMessage = {
  protocol: 'beckman-au',
  raw: dReal,
  records: [['D', dRealH.sampleId]]
} as ProtocolMessage
const realRes = parseBeckmanAu(realMsg, 'inst-rohtak', fmt, override)
check('live D decodes 1 analyte', realRes.length === 1, `got ${realRes.length}`)
check(
  '  014 -> GLU = 78.8',
  realRes[0]?.analyteCode === 'GLU' && parseFloat(realRes[0]?.value ?? '') === 78.8,
  `got ${realRes[0]?.analyteCode}=${realRes[0]?.value}`
)

// Multi-analyte coverage: same measured header, result groups appended (the
// group layout is unchanged and confirmed by the live frame above).
const dBlock =
  'D 000305 0081             9281305    E0                          20260818161505' +
  '001  3.33  009 0.335  025  6.93  002 134.5  003  17.9  028  9.45  012 0.029  005  20.2  013  12.5  029   2.5  006  9.10  024 0.238  097 135.8  098 4.186  099 102.7  '
const dh = parseAuHeader(dBlock, fmt)
check('D header -> SID 9281305', dh.sampleId === '9281305', `got "${dh.sampleId}"`)

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

// ---- 4. Live regression (2026-08-18): the analyzer's sample-ID field width is
// a site-configurable Online setting and it CHANGED — 26 chars in the July eLab
// capture, 20 chars today:
//     RX <STX>R 000301N0095             9501268<ETX>     (13 + 20)
// The response must MIRROR the width the request carried. A build that instead
// right-justified the barcode into the preset's fixed 26-char field sent 6 bytes
// too many, and the analyzer silently refused to ACK it (ONLINE ERROR 05 / T4).
const rLive = 'R 000301N0095             9501268'
const expectedLive = 'S 000301 0095             9501268    E014'
const builtLive = buildAuOrderResponse(rLive, [14], fmt, { demographics: false })
check('S mirrors the request width (20-char id field)', builtLive === expectedLive,
  builtLive === expectedLive ? '' : `\n      built:    "${builtLive}" (${builtLive.length}B)\n      expected: "${expectedLive}" (${expectedLive.length}B)`)
check('  and never pads to the stale 26-char width', !builtLive.includes('                   9501268'))

// ---- 5. Post-service regression (2026-09-21): the width moved AGAIN ---------
// After a Beckman service visit the analyzer's request came back with the July
// 26-char sample-ID field while the preset still says 20:
//     RX <STX>R 000801N0001                   9671140<ETX>     (13 + 26)
// The old fixed slice read 19 spaces + "9" and ordered tests for barcode "9".
// The parser must recover the whole barcode whichever way the width is wrong,
// and the S echo must still mirror the request byte-exact.
const rWide = 'R 000801N0001                   9671140'
const rWideH = parseAuHeader(rWide, fmt)
check('R with a WIDER id field than configured -> SID 9671140', rWideH.sampleId === '9671140',
  `got "${rWideH.sampleId}"`)
const expectedWideS = 'S 000801 0001                   9671140    E014'
const builtWideS = buildAuOrderResponse(rWide, [14], fmt, { demographics: false })
check('  S echo mirrors the 26-char request', builtWideS === expectedWideS,
  builtWideS === expectedWideS ? '' : `
      built:    "${builtWideS}"
      expected: "${expectedWideS}"`)

// If the request width reverted, the result layout has most likely reverted to
// July's too (26-char id, "␠␠␠␠E" + 14-digit Run Date/Time, then groups). This
// is eLab's real 2026-07-23 D frame; it must decode under the CURRENT preset
// widths because the body is anchored on the Run Date/Time stamp.
const dJuly =
  'D 000101 0195                   8806436    E20260723000909' +
  '001  4.52  009 1.072  026  50.5  025  7.75  028 21.39  012 0.095  005  29.7  013  21.3  029   4.3  006  9.31  007 195.8  024 0.619  '
const dJulyH = parseAuHeader(dJuly, fmt)
check('July-layout D under the August widths -> SID 8806436', dJulyH.sampleId === '8806436',
  `got "${dJulyH.sampleId}"`)
const julyRes = parseBeckmanAu(
  { protocol: 'beckman-au', raw: dJuly, records: [['D', dJulyH.sampleId]] } as ProtocolMessage,
  'inst-rohtak', fmt, override)
const julyGot = new Map(julyRes.map((r) => [r.analyteCode, r.value]))
const JULY_EXPECT: Array<[string, string]> = [
  ['ALB', '4.52'], ['CRE', '1.072'], ['TRIG', '50.5'], ['TP', '7.75'], ['UREA', '21.39'],
  ['DBIL', '0.095'], ['AST', '29.7'], ['GGT', '21.3'], ['UA', '4.3'], ['CA', '9.31'],
  ['CHOL', '195.8'], ['TBIL', '0.619']
]
check(`  decodes ${JULY_EXPECT.length} analytes`, julyRes.length === JULY_EXPECT.length, `got ${julyRes.length}`)
for (const [code, val] of JULY_EXPECT) {
  const g = julyGot.get(code)
  check(`  ${code} = ${val}`, g != null && parseFloat(g) === parseFloat(val), `got ${g ?? '(missing)'}`)
}

// And the mirror case: a preset that says 26 while the analyzer sends 20 (the
// August live frame). The first token is the barcode; the stamp anchors the body.
const fmt26 = mergeAuFormat({ ...(inst.auFormat as Record<string, number | boolean>), sampleId: 26, dummy: 40 })
const dRealH26 = parseAuHeader(dReal, fmt26)
check('August D under a 26-char preset -> SID 9281305', dRealH26.sampleId === '9281305',
  `got "${dRealH26.sampleId}"`)
const realRes26 = parseBeckmanAu(
  { protocol: 'beckman-au', raw: dReal, records: [['D', dRealH26.sampleId]] } as ProtocolMessage,
  'inst-rohtak', fmt26, override)
check('  still decodes 014 -> GLU = 78.8',
  realRes26.length === 1 && realRes26[0]?.analyteCode === 'GLU' && parseFloat(realRes26[0]?.value ?? '') === 78.8,
  `got ${realRes26.map((r) => r.analyteCode + '=' + r.value).join(',') || '(none)'}`)

console.log('')
if (failed > 0) { console.log(`${failed} FAILURE(S)`); process.exit(1) }
console.log('ALL PASS')
