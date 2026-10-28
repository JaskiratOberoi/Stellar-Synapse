/**
 * Verify the HbA1c -> eAG derivation that feeds Noble's eAG parameter.
 *
 * Noble's eAG row is mg/dL at every site, while the LD-560 (Zeus D-20) reports
 * its own eAG in mmol/L. Lucknow 2026-10-28: with the Auto eAG switch off, the
 * analyzer's 5.8 mmol/L went into the row where 105.4 mg/dL was due, 16 times
 * in one day. So the analyzer's eAG must NEVER reach the LIS — switch on =
 * the calculated mg/dL value, switch off = no eAG at all.
 * Run: npm run verify:eag
 */
import { applyHba1cDerivations, eagFromHba1c } from '../src/main/core/drivers/parsing'
import type { CanonicalResult } from '../src/shared/types'

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

function res(code: string, value: string, unit?: string): CanonicalResult {
  return {
    id: code,
    instrumentId: 'd20',
    sampleId: '8757646',
    analyteCode: code,
    value,
    unit,
    flag: 'N',
    receivedAt: '2026-10-28T00:05:28.000Z'
  }
}

// ADA formula: eAG = 28.7 * A1C - 46.7 (professional.diabetes.org/glucose_calc).
const adaTable: Array<[number, number]> = [
  [6, 126],
  [6.5, 140],
  [7, 154],
  [7.5, 169],
  [8, 183],
  [8.5, 197]
]
for (const [a1c, mgdl] of adaTable) {
  const got = eagFromHba1c(a1c)
  check(`ADA table: ${a1c}% -> ${mgdl} mg/dL`, got !== null && Math.round(got) === mgdl, `got ${got}`)
}
check('out of range (3%) derives nothing', eagFromHba1c(3) === null)
check('out of range (21%) derives nothing', eagFromHba1c(21) === null)

// The Lucknow frame shape: HbA1c plus the analyzer's own mmol/L eAG.
const frame = [res('HBA1A', '0.2', '%'), res('HBA1C', '5.3', '%'), res('eAG', '5.8', 'mmol/L')]

const on = applyHba1cDerivations(frame, { autoEag: true, instrumentId: 'd20' })
const onEag = on.filter((r) => r.analyteCode.toLowerCase() === 'eag')
check('auto on: exactly one eAG', onEag.length === 1, `${onEag.length}`)
check('auto on: it is the calculated mg/dL value', onEag[0]?.value === '105.4' && onEag[0]?.unit === 'mg/dL', `${onEag[0]?.value} ${onEag[0]?.unit}`)
check('auto on: HbA1c still present', on.some((r) => r.analyteCode === 'HBA1C' && r.value === '5.3'))

const off = applyHba1cDerivations(frame, { autoEag: false, instrumentId: 'd20' })
const offEag = off.filter((r) => r.analyteCode.toLowerCase() === 'eag')
check('auto off: NO eAG at all (analyzer mmol/L never passes through)', offEag.length === 0, `${offEag.map((r) => `${r.value} ${r.unit}`).join(',')}`)
check('auto off: HbA1c and the other fractions untouched', off.length === 2 && off.some((r) => r.analyteCode === 'HBA1A'))

// Maestro shape: HbA1c only, no analyzer eAG.
const maestro = applyHba1cDerivations([res('HbA1c', '6.15', 'NGSP')], { autoEag: true, instrumentId: 'mae' })
check('Maestro: HbA1c rounded to one decimal', maestro.some((r) => r.analyteCode === 'HbA1c' && r.value === '6.2'))
check('Maestro: eAG derived from the rounded value', maestro.some((r) => r.analyteCode === 'eAG' && r.value === '131.2' && r.unit === 'mg/dL'))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
