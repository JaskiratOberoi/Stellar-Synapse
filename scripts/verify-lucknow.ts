/**
 * Lucknow (MEDSKY) Mindray BS-series onboarding checks.
 *
 * Everything here is pinned to REAL bytes from the site's eLab Assist capture
 * (26-30 Aug 2026) and to the Noble rows those samples actually registered, so a
 * drift in the driver, the panel or the preset fails here rather than in the lab.
 */
import { parseMindrayAstm, MINDRAY_BS_CHEM } from '../src/main/core/drivers/mindray'
import { roundResultValue } from '../src/main/core/engine/units'
import lucknow from '../presets/lucknow.json'
import type { ProtocolMessage } from '../src/main/core/protocols/IProtocol'

let fail = 0
const check = (label: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) fail++
}

// ---- 1. A real result frame from logINMessage_30082026.log -------------------
// SID 8689560, four analytes. The analyzer transmits full internal precision
// (1.538779); the driver rounds to 2 dp on parse, which is what the reference
// eLab interface uploads and what Noble holds for these very samples.
const raw = [
  'H|\\^&|||Mindry^^|||||||PR|1394-97|20260830000304',
  'P|174||PATIENT111||ABC^^||19600315^66^Y|M||||||||||||||||||||||||||',
  'O|174|114^1^18|8689560|CREAT^CRE R^^\\URIC^URIC ACID^^\\CAL^CA. SB^^\\UREA^UREA^^|R|20260829234657|20260829235701|||||||20260829234657|serum||||||||||F|||||',
  'R|132|CREAT^CRE R^^F|1.538779^^^^|mg/dL|^|N||F|1.538779^^^^|0|20260830000221||Mindry^',
  'R|133|URIC^URIC ACID^^F|10.781984^^^^|mg/dL|^|N||F|10.781984^^^^|0|20260829235757||Mindry^',
  'R|134|CAL^CA. SB^^F|7.549387^^^^|mg/dL|^|N||F|7.549387^^^^|0|20260829235915||Mindry^',
  'R|135|UREA^UREA^^F|51.595075^^^^|mg/dL|^|N||F|51.595075^^^^|0|20260830000304||Mindry^',
  'L|184|N'
].join('\r')

const msg: ProtocolMessage = {
  protocol: 'astm',
  raw,
  records: raw.split('\r').map((r) => r.split('|'))
} as ProtocolMessage

const results = parseMindrayAstm(msg, 'inst-lucknow')
check('real frame decodes 4 analytes', results.length === 4, `got ${results.length}`)
check(
  '  barcode from the O Specimen ID, not the sequence field',
  results.every((r) => r.sampleId === '8689560'),
  `got ${[...new Set(results.map((r) => r.sampleId))].join(',')}`
)
const byCode = Object.fromEntries(results.map((r) => [r.analyteCode, r]))
// wire value -> decoded value -> what Noble actually holds for this sample.
for (const [code, value, unit] of [
  ['CREAT', '1.54', 'mg/dL'],
  ['URIC', '10.78', 'mg/dL'],
  ['CAL', '7.55', 'mg/dL'],
  ['UREA', '51.6', 'mg/dL']
] as const) {
  check(`  ${code} = ${value} ${unit}`, byCode[code]?.value === value && byCode[code]?.unit === unit,
    `got ${byCode[code]?.value} ${byCode[code]?.unit}`)
}

// ---- 2. Precision matches what Noble holds for these samples ----------------
// Read back from Noble: CREAT 1.54, CAL 7.55, UREA 51.6 — the driver's round2
// reproduces each exactly, trailing zeros trimmed rather than padded.
check('CREAT 1.538779 -> 1.54 at maxDp 2', roundResultValue('1.538779', 2) === '1.54', `got ${roundResultValue('1.538779', 2)}`)
check('CAL 7.549387 -> 7.55', roundResultValue('7.549387', 2) === '7.55', `got ${roundResultValue('7.549387', 2)}`)
check('UREA 51.595075 -> 51.6 (trimmed, not padded)', roundResultValue('51.595075', 2) === '51.6', `got ${roundResultValue('51.595075', 2)}`)
check('GLU 226.470520 -> 226.47', roundResultValue('226.470520', 2) === '226.47', `got ${roundResultValue('226.470520', 2)}`)

// ---- 3. Panel covers every code the site actually transmits ------------------
// The 21 codes the analyzer RETURNS, built by parsing every R record in the
// capture. "Iron" is mixed case and was missed by a first uppercase-only scan —
// it is the fifth-busiest channel here (588 results), so this list is asserted
// rather than trusted.
const TRANSMITTED = ['GLU','UREA','CREAT','URIC','BIT','BID','SGPT','SGOT','ALP','GGT','TP','ALB','CHOL','TRIG','CAL','CRP','PHOS','LIP','AMY','ADA','Iron']
// Ordered by eLab but no result in the captured window; real channels, mapped ready.
const ORDERED_ONLY = ['HDL','LDL','TIBC','UIBC']
const panel = new Set(MINDRAY_BS_CHEM.map((a) => a.code))
const missingFromPanel = TRANSMITTED.filter((c) => !panel.has(c))
check('driver panel covers all 21 transmitted codes', missingFromPanel.length === 0, `missing ${missingFromPanel.join(',')}`)

// ---- 4. Preset maps every transmitted code to a Noble target -----------------
const inst = lucknow.instruments[0]
const mapped = new Map(inst.mappings.map((m) => [m.instrumentCode, m]))
const unmapped = TRANSMITTED.filter((c) => !mapped.has(c))
check('preset maps all 21 transmitted codes', unmapped.length === 0, `unmapped ${unmapped.join(',')}`)
check('  including the mixed-case Iron channel', mapped.get('Iron')?.lisTestCode === 'BI137')
const unorderedMissing = ORDERED_ONLY.filter((c) => !mapped.has(c))
check('preset maps the ordered-but-unresulted channels', unorderedMissing.length === 0, `unmapped ${unorderedMissing.join(',')}`)
const live = inst.mappings.filter((m) => m.status !== 'ignored')
check('every live mapping carries a Noble test id', live.every((m) => typeof m.lisTestId === 'number'))
const codes = inst.mappings.map((m) => m.instrumentCode)
check('no duplicate analyte codes', new Set(codes).size === codes.length)

// Targets that were read back from this site's own Noble rows.
for (const [code, testId, testCode, paramId] of [
  ['GLU', 284, 'BI114', undefined],
  ['UREA', 172, 'BI224', undefined],
  ['BIT', 87, 'BI046', 431],
  ['BID', 87, 'BI046', 430],
  ['TP', 163, 'BI213', 678],
  ['ALB', 163, 'BI213', 676],
  ['CRP', 113, 'MS024', 491]
] as const) {
  const m = mapped.get(code)
  check(`  ${code} -> t${testId} ${testCode}${paramId ? '/p' + paramId : ''}`,
    m?.lisTestId === testId && m?.lisTestCode === testCode && m?.lisParamId === paramId,
    `got t${m?.lisTestId} ${m?.lisTestCode}/p${m?.lisParamId}`)
}

// Glucose must stay test-level so variant retargeting can pick Fasting/PP/Random.
check('GLU has no pinned paramId (variant retargeting stays live)', mapped.get('GLU')?.lisParamId === undefined)

// TC/TG duplicate CHOL/TRIG onto one Noble test each. Both must stay retired, or
// the host query orders two channels for one test — the Rohtak failure mode.
for (const dup of ['TC', 'TG']) {
  check(`${dup} stays 'ignored' (duplicate channel)`, mapped.get(dup)?.status === 'ignored')
}
const targets = live.map((m) => `${m.lisTestId}/${m.lisParamId ?? '-'}`)
check('no two live channels claim the same Noble target', new Set(targets).size === targets.length,
  `repeated: ${targets.filter((t, i) => targets.indexOf(t) !== i).join(',')}`)

// Electrolytes are absent from BOTH directions of the capture — zero results and
// zero eLab orders — so nothing here may claim them.
const electrolyteCodes = ['Na', 'K', 'Cl', 'NA', 'CL']
check('no electrolyte mapping (absent from results AND orders)',
  !inst.mappings.some((m) => electrolyteCodes.includes(m.instrumentCode)))

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS')
process.exit(fail ? 1 : 0)
