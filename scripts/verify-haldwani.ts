/**
 * Verification of the Haldwani AU480 preset against the REAL frames captured on
 * the Haldwani install (synapse-2026-10-02.log, v0.6.10 @ COM1 9600 8-N-1).
 *
 * After the v0.6.10 upgrade the site re-added the AU480 from this preset, which
 * still said 7-N-1. Synapse could read the analyzer but the analyzer could not
 * decode our ACKs or S frames, so it retransmitted every frame and raised ONLINE
 * ERROR. The serial assertion below is the regression guard for that; the frame
 * checks pin the R -> S order response (byte-exact against the TX the analyzer
 * ACKed) and the D-frame decode through the site's Online Test No. table.
 * Run: npm run verify:haldwani
 */
import { parseBeckmanAu, buildAuOrderResponse } from '../src/main/core/drivers/beckmanAu'
import { parseAuHeader, mergeAuFormat } from '../src/main/core/protocols/beckmanAu'
import type { ProtocolMessage } from '../src/main/core/drivers/IInstrumentDriver'
import { PRESETS } from '../src/main/core/presets/registry'
import { MappingEngine } from '../src/main/core/mapping/MappingEngine'

let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

const preset = PRESETS.find((p) => p.preset === 'haldwani')
const au = preset?.instruments.find((i) => i.driverId === 'beckman-au480')
check('haldwani preset carries a beckman-au480 entry', !!au)
if (!au) process.exit(1)

// ---- 1. Serial: the regression that broke the site --------------------------
const s = au.serial ?? {}
check(
  'serial is 9600 8-N-1',
  s.baudRate === 9600 && s.dataBits === 8 && s.parity === 'none' && s.stopBits === 1,
  JSON.stringify(s)
)

// ---- 2. Wire format is now read (was ignored under the "onlineFormat" key) ---
check('auFormat is applied by the registry', !!au.auFormat)
const fmt = mergeAuFormat(au.auFormat)
const override = au.auOnlineTestNos ?? []
check('Online Test No. table present', override.length === 32, `got ${override.length}`)

// ---- 3. R request -> S order response, byte-exact ---------------------------
const rLive = 'R 000901N0051             9775015'
const rh = parseAuHeader(rLive, fmt)
check('R header -> SID 9775015', rh.sampleId === '9775015', `got "${rh.sampleId}"`)

const ORDERED = ['UA', 'TP', 'CREAT', 'DBILC', 'TBILC', 'ALB', 'CHOL', 'HDL-C', 'LDL-C', 'GGT', 'CALA', 'Na', 'K', 'Cl']
const byCode = new Map(override.map((e) => [e.code.toUpperCase(), e.no]))
const testNos = ORDERED.map((c) => byCode.get(c.toUpperCase()) as number)
const sLive =
  'S 000901 0051             9775015    EM00000                    003004005006008010011012014018020097098099'
const sOut = buildAuOrderResponse(rLive, testNos, fmt, {
  patientName: '',
  demographics: au.auFormat?.responseDemographics,
  patientInfo: au.auFormat?.responsePatientInfo
})
check('S response matches the frame the analyzer ACKed', sOut === sLive, sOut === sLive ? '' : `\n  got  "${sOut}"\n  want "${sLive}"`)

// ---- 4. D result decode through the site table ------------------------------
const dLive =
  'D 000901 0051             9775015    EM00000                    ' +
  '003  4.31  004  6.68  005  0.64  006  0.07  008  0.28  010  3.96  011 187.5  018  15.0  020   9.2  097   138  098   4.4  099   105  '
const dh = parseAuHeader(dLive, fmt)
check('D header -> SID 9775015', dh.sampleId === '9775015', `got "${dh.sampleId}"`)
const msg = { protocol: 'beckman-au', raw: dLive, records: [['D', dh.sampleId]] } as unknown as ProtocolMessage
const got = new Map(parseBeckmanAu(msg, 'inst-haldwani', fmt, override).map((r) => [r.analyteCode, r.value]))
const EXPECT: Array<[string, string]> = [
  ['UA', '4.31'], ['TP', '6.68'], ['CREAT', '0.64'], ['DBILC', '0.07'], ['TBILC', '0.28'], ['ALB', '3.96'],
  ['CHOL', '187.5'], ['GGT', '15.0'], ['CALA', '9.2'], ['Na', '138'], ['K', '4.4'], ['Cl', '105']
]
check(`D decodes ${EXPECT.length} analytes`, got.size === EXPECT.length, `got ${got.size}`)
for (const [code, value] of EXPECT) {
  check(`  ${code} = ${value}`, parseFloat(got.get(code) ?? 'NaN') === parseFloat(value), `got ${got.get(code)}`)
}

// ---- 5. The Jammu table must NOT be used here --------------------------------
// The same frame through Jammu's numbering wrote CHOL into Bilirubin Total and
// GGT into ALP on 2026-10-02. Prove the two tables disagree on these numbers.
const jammu = PRESETS.find((p) => p.preset === 'jammu')?.instruments.find((i) => i.driverId === 'beckman-au480')
const jGot = new Map(
  parseBeckmanAu(msg, 'inst-jammu', fmt, jammu?.auOnlineTestNos ?? []).map((r) => [r.analyteCode, r.value])
)
check('Jammu table decodes 011 as TBILC (wrong for Haldwani)', jGot.get('TBILC') === '187.5', `got ${jGot.get('TBILC')}`)

// ---- 6. Mappings: the Noble slots this AU actually fills --------------------
// Taken from 90 days of Haldwani rows in Noble (2026-10-02). The bilirubin and
// protein channels are parameters of shared panels — pin them so a later edit
// cannot collapse them back onto one test-level row.
const rule = new Map((au.mappings ?? []).map((m) => [m.instrumentCode, m]))
const slot = (code: string): string => {
  const m = rule.get(code)
  return m ? `${m.lisTestId}/${m.lisParamId ?? '-'}` : 'missing'
}
const SLOTS: Array<[string, string]> = [
  ['DBILC', '87/430'], ['TBILC', '87/431'], ['TP', '163/678'], ['ALB', '163/676'],
  ['UA', '173/-'], ['CREAT', '114/-'], ['CHOL', '104/-'], ['GGT', '130/-'], ['CALA', '96/-'],
  ['ALT', '79/-'], ['AST', '81/-'], ['ALP', '279/-'], ['UREA', '172/-'], ['TRIG', '168/-'],
  ['Na', '157/-'], ['K', '297/-'], ['Cl', '101/-'], ['GLU', '284/-'], ['RF', '1890/-']
]
for (const [code, want] of SLOTS) check(`mapping ${code} -> ${want}`, slot(code) === want, `got ${slot(code)}`)
check('every mapping is manual (locked against auto-map)', (au.mappings ?? []).every((m) => m.status === 'manual'))

// ---- 7. Re-onboarding over the Jammu rules restores Haldwani's targets ------
// On 2026-10-02 the Jammu preset was applied on the Haldwani PC first; the
// Haldwani preset must overwrite every overlapping rule on the shared driver.
const engine = new MappingEngine({} as never)
engine.applyPresetMappings('beckman-au480', jammu?.mappings ?? [])
engine.applyPresetMappings('beckman-au480', au.mappings ?? [])
const live = (code: string): string => {
  const r = engine.resolve({ analyteCode: code } as never, 'beckman-au480')
  return r ? `${r.lisTestId}/${r.lisParamId ?? '-'}` : 'missing'
}
for (const code of ['TP', 'DBILC', 'TBILC', 'ALB', 'ALP', 'TRIG', 'IRON', 'UIBC']) {
  check(`after Jammu then Haldwani: ${code} -> ${slot(code)}`, live(code) === slot(code), `got ${live(code)}`)
}

// ---- 8. Host query: LIS orders -> analyzer channels -------------------------
const order = (codes: string[], names: string[]): string =>
  engine.instrumentCodesForLisTests('beckman-au480', codes, names).sort().join(',')
check('BI046 bilirubin panel orders DBILC + TBILC', order(['BI046'], []) === 'DBILC,TBILC', order(['BI046'], []))
check(
  'standalone BI048 "Bilirubin Total" orders TBILC only',
  order(['BI048'], ['Bilirubin Total']) === 'TBILC',
  order(['BI048'], ['Bilirubin Total'])
)
check('BI213 total-protein panel orders ALB + TP', order(['BI213'], []) === 'ALB,TP', order(['BI213'], []))
check('standalone BI019 "Albumin" orders ALB', order(['BI019'], ['Albumin']) === 'ALB', order(['BI019'], ['Albumin']))

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Haldwani AU480 checks passed')
process.exit(failed ? 1 : 0)
