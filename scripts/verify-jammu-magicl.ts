/**
 * Jammu Getein MAGICL 6000i preset checks.
 *
 * The item ids come from the lab's own spreadsheet; every Noble target was read
 * back from what Jammu itself registers. This pins both, plus the decisions that
 * are easy to undo by accident.
 */
import jammu from '../presets/jammu.json'

let fail = 0
const check = (label: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) fail++
}

const inst = jammu.instruments.find((i) => i.driverId === 'magicl-6000i')
check('Jammu preset carries a MAGICL 6000i', !!inst)
if (!inst) process.exit(1)

const mapped = new Map(inst.mappings.map((m) => [m.instrumentCode, m]))

// The 17 item ids on the lab's sheet (SEP 2026).
const SHEET: [string, string][] = [
  ['19', 'T3'], ['20', 'T4'], ['18', 'TSH'], ['151', 'VIT D3'], ['139', 'VIT B12'],
  ['26', 'B-HCG'], ['25', 'IGE'], ['102', 'PRL'], ['21', 'FT3'], ['22', 'FT4'],
  ['24', 'FSH'], ['2', 'CA125'], ['27', 'LH'], ['6', 'FERRITIN'],
  ['34', 'TESTOSTERONE TOTAL'], ['157', 'ANTI CCP'], ['8', 'TPSA']
]
const missing = SHEET.filter(([c]) => !mapped.has(c)).map(([c, n]) => `${c} ${n}`)
check('all 17 sheet item ids are mapped', missing.length === 0, `missing ${missing.join(', ')}`)
check('nothing extra beyond the sheet', inst.mappings.length === 17, `got ${inst.mappings.length}`)
check('every mapping carries a Noble test id', inst.mappings.every((m) => typeof m.lisTestId === 'number'))

// Targets read back from Jammu's own rows.
for (const [code, testId, testCode] of [
  ['18', 170, 'BI221'], ['19', 164, 'BI214'], ['20', 165, 'BI215'],
  ['21', 128, 'BI109'], ['22', 129, 'BI110'], ['139', 175, 'BI235'],
  ['151', 74, 'BI005'], ['34', 158, 'BI209'], ['8', 151, 'BI181'],
  ['2', 92, 'BI058'], ['6', 123, 'BI104'], ['157', 629, 'BI036']
] as const) {
  const m = mapped.get(code)
  check(`  ${code} -> t${testId} ${testCode}`, m?.lisTestId === testId && m?.lisTestCode === testCode,
    `got t${m?.lisTestId} ${m?.lisTestCode}`)
}

// Vitamin D must be 151, never Delhi's 42 — and never both, which is what put
// three vitamin D codes in one Rohtak host query and made the analyzer drop it.
check("vitamin D is item 151", mapped.get('151')?.lisTestCode === 'BI005')
check('  item 42 is NOT also mapped', !mapped.has('42'))

// Testosterone must hit Total, never Noble's separate Free field (BI208/t159).
check('testosterone targets Total (BI209), not Free (BI208)',
  mapped.get('34')?.lisTestCode === 'BI209' && mapped.get('34')?.lisTestId === 158)

// beta-hCG must be the quantitative total, not the prenatal Free beta hCG.
check('beta-hCG targets BI044 total, not Free beta hCG',
  mapped.get('26')?.lisTestCode === 'BI044' &&
  !inst.mappings.some((m) => ['BI244', 'BI244A', 'BC0002'].includes(String(m.lisTestCode))))

// FT3 relies on the guarded pmol/L -> pg/mL conversion; its target unit must stay
// pg/mL or the rule silently stops firing.
check('FT3 target unit stays pg/mL (keeps the x0.651 rule live)', mapped.get('21')?.unit === 'pg/mL')

// No two channels may claim one Noble target — the Rohtak duplicate-order failure.
const targets = inst.mappings.map((m) => `${m.lisTestId}/${m.lisParamId ?? '-'}`)
check('no two channels claim the same Noble target', new Set(targets).size === targets.length,
  `repeated: ${targets.filter((t, i) => targets.indexOf(t) !== i).join(',')}`)

// The two unresolved units must keep carrying their warning.
for (const code of ['22', '34']) {
  check(`  item ${code} still flags its unconfirmed unit`, /UNVERIFIED|NEEDS CONFIRMING/.test(String(mapped.get(code)?._note ?? '')))
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS')
process.exit(fail ? 1 : 0)
