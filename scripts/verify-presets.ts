/**
 * Verify the per-site Beckman AU "Online" Test No. override actually changes how
 * results decode — the safety-critical guarantee behind location presets.
 *
 * The decisive case: wire number 016 is ALT under the default numbering but AST
 * under Jammu's table (the two are swapped). Same bytes, different analyte.
 *
 * Run: npx esbuild scripts/verify-presets.ts --bundle --platform=node --format=esm --outfile=scripts/.verify-presets.mjs && node scripts/.verify-presets.mjs
 */
import { parseBeckmanAu } from '../src/main/core/drivers/beckmanAu'
import { DEFAULT_AU_FORMAT } from '../src/main/core/protocols/beckmanAu'
import type { ProtocolMessage } from '../src/main/core/protocols/IProtocol'
import type { AuOnlineTestNo } from '../src/shared/types'
import jammu from '../presets/jammu.json'

let failures = 0
const check = (label: string, actual: unknown, expected: unknown): void => {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`)
}

/** Build a minimal AU "D" result frame: 64-char header + one 11-char group. */
function dFrame(onlineNo: number, value: string): ProtocolMessage {
  const header = 'D'.padEnd(64, ' ')
  const group =
    String(onlineNo).padStart(DEFAULT_AU_FORMAT.testNo, '0') +
    value.padStart(DEFAULT_AU_FORMAT.result, ' ').slice(-DEFAULT_AU_FORMAT.result) +
    '  '
  return {
    protocol: 'beckman-au',
    raw: header + group,
    records: [['D', 'SID001']]
  } as unknown as ProtocolMessage
}

// Jammu's normalized override (mirror the app's registry: onlineNo + synapseCode).
const jammuOverride: AuOnlineTestNo[] = (jammu.instruments[0].onlineTestNoMap.entries as Array<Record<string, unknown>>)
  .map((e) => ({
    no: Number(e.onlineNo),
    code: String((e.synapseCode as string) ?? (e.analyzerCode as string) ?? '')
  }))
  .filter((e) => Number.isFinite(e.no) && e.code.length > 0)

// 1. Default numbering: 016 = ALT.
check('default 016', parseBeckmanAu(dFrame(16, '45.0'), 'i1')[0]?.analyteCode, 'ALT')
// 2. Jammu numbering: 016 = AST (the swap).
check('jammu 016', parseBeckmanAu(dFrame(16, '45.0'), 'i1', undefined, jammuOverride)[0]?.analyteCode, 'AST')
// 3. Jammu 017 = ALT (the other half of the swap).
check('jammu 017', parseBeckmanAu(dFrame(17, '30.0'), 'i1', undefined, jammuOverride)[0]?.analyteCode, 'ALT')
// 4. Jammu 006 = GLU (default would be DBILC=6).
check('jammu 006', parseBeckmanAu(dFrame(6, '95'), 'i1', undefined, jammuOverride)[0]?.analyteCode, 'GLU')
check('default 006', parseBeckmanAu(dFrame(6, '0.2'), 'i1')[0]?.analyteCode, 'DBILC')
// 5. Jammu-only analyte: 038 = LDH28 (not in the default menu; default would skip it).
check('jammu 038 code', parseBeckmanAu(dFrame(38, '210'), 'i1', undefined, jammuOverride)[0]?.analyteCode, 'LDH28')
check('default 038 skipped', parseBeckmanAu(dFrame(38, '210'), 'i1').length, 0)
// 6. Value survives decoding.
check('jammu 016 value', parseBeckmanAu(dFrame(16, '45.0'), 'i1', undefined, jammuOverride)[0]?.value, '45.0')

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
