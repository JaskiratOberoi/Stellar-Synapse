import { convertForLis } from '../src/main/core/engine/units'
import type { CanonicalResult, MappingRule } from '../src/shared/types'

let fail = 0
const check = (label: string, ok: boolean, extra = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) fail++
}
const res = (code: string, name: string, value: string, unit: string): CanonicalResult =>
  ({ sampleId: 'S1', analyteCode: code, analyteName: name, value, unit }) as CanonicalResult
const rule = (unit: string, instrumentName: string, lisTestName: string): MappingRule =>
  ({ driverId: 'magicl-6000i', instrumentCode: 'x', unit, instrumentName, lisTestName }) as MappingRule

// Unit handling for the Rohtak MAGICL 6000i, read off the analyzer's Item Param
// screens. Only ONE analyte on this instrument needs conversion; the rest either
// already agree with Noble or are deliberately passed through (see FT4 below).

// Testosterone (item 34) transmits ug/dL where Noble's field holds ng/dL. Purely
// dimensional, and no other Rohtak instrument emits ug/dL, so it cannot disturb
// the 6200's verified behaviour.
const testo = convertForLis(res('34', 'Testosterone', '0.5', 'ug/dL'), rule('ng/dL', 'Testosterone', 'Testosterone - Total'))
check('Testosterone 0.5 ug/dL -> 500 ng/dL', testo.value === '500' && testo.unit === 'ng/dL', `got ${testo.value} ${testo.unit}`)
check('  a normal male reads normal, not hypogonadal', parseFloat(testo.value) > 300)

// FT3 (21) pmol/L -> pg/mL keeps its existing, separately verified conversion.
const ft3 = convertForLis(res('21', 'FT3', '5.00', 'pmol/L'), rule('pg/mL', 'FT3', 'T3 - Free (Tri-iodothyronine-Free)'))
check('FT3 5 pmol/L -> 3.25 pg/mL', ft3.value === '3.25', `got ${ft3.value}`)

// FT4 (22) also arrives pmol/L, but Rohtak's Noble FT4 field is calibrated to the
// RAW analyzer number — eLab writes it unconverted (SID 9282585: wire 12.64 ->
// Noble 12.64) and the lab's reference range is set for that. It must therefore
// pass through untouched, exactly as it does for the sister MAGICL 6200.
const ft4 = convertForLis(res('22', 'FT4', '12.64', 'pmol/L'), rule('ng/L', 'FT4', 'T4 - Free (Thyroxine - Free)'))
check('FT4 pmol/L passes through RAW (matches eLab + the 6200)', ft4.value === '12.64', `got ${ft4.value}`)

// Units that already agree must not be touched.
for (const [code, name, unit] of [['18','TSH','uIU/mL'],['19','T3','ng/mL'],['20','T4','ug/dL'],['102','PRL','ng/mL'],['139','Vitamin B12','pg/mL']] as const) {
  const r = convertForLis(res(code, name, '7.77', unit), rule(unit, name, name))
  check(`${name} ${unit} passes through`, r.value === '7.77', `got ${r.value}`)
}

// ug/dL -> ng/dL must not fire for T4, whose Noble field is ug/dL on both sides.
const t4 = convertForLis(res('20', 'T4', '8.20', 'ug/dL'), rule('ug/dL', 'T4', 'T4 (Thyroxine )'))
check('T4 ug/dL -> ug/dL is NOT scaled', t4.value === '8.20', `got ${t4.value}`)

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS')
process.exit(fail ? 1 : 0)
