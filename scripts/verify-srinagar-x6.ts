/**
 * Srinagar SNIBE MAGLUMI X6 onboarding checks.
 *
 * Everything here is pinned to REAL bytes from the site's eLab Assist capture
 * (logINMessage 21-24 Sep 2026, COM6) and to the Noble rows those samples
 * registered against, so a drift in the driver, the channel table, the unit
 * rules or the preset fails here rather than in the lab.
 *
 * Run:  npm run verify:srinagar-x6
 */
import { AstmProtocol } from '../src/main/core/protocols/astm'
import { buildAstmOrderRecords, frameAstmSimple } from '../src/main/core/protocols/astmHostQuery'
import { extractAstmQuery, parseAstm } from '../src/main/core/drivers/parsing'
import { MAGLUMI_X6_CHANNELS, maglumiChannel } from '../src/main/core/drivers/maglumi'
import { getDriver } from '../src/main/core/drivers/registry'
import { fingerprintInstrument } from '../src/main/core/discovery/fingerprint'
import { convertForLis } from '../src/main/core/engine/units'
import type { CanonicalResult, MappingRule } from '../src/shared/types'
import srinagar from '../presets/srinagar.json'

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
    console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`)
  }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  ok(
    name,
    actual === expected,
    `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
  )
}

const ENQ = '\x05'
const STX = '\x02'
const ETX = '\x03'
const EOT = '\x04'
const CR = '\r'

/** The analyzer's own H record, verbatim from the capture. */
const X6_HEADER = 'H|\\^&||PSWD|X6 User|||||Lis||P|E1394-97|20260921'

/** One upload exactly as the X6 sends it: H P O R L, no frame numbers, no checksums. */
function upload(sid: string, r: string): string {
  return (
    ENQ +
    STX +
    [X6_HEADER, 'P|1', `O|1|${sid}||^^^${r.split('|')[2].replace(/^\^\^\^/, '')}`, r, 'L|1|N'].join(
      CR
    ) +
    CR +
    ETX +
    EOT
  )
}

type Row = {
  instrumentCode: string
  instrumentName?: string
  analyzerCode?: string
  unit?: string
  status?: string
  lisTestId?: number
  lisTestCode?: string
  lisTestName?: string
  lisParamId?: number
  lisParamName?: string
  _evidence?: { x6Unit?: string; source?: string }
}
const inst = (
  srinagar as {
    instruments: Array<{
      driverId: string
      transports?: string[]
      mappings?: Row[]
      mappingsSummary?: { total: number }
    }>
  }
).instruments.find((i) => i.driverId === 'maglumi-x6')
const rows: Row[] = inst?.mappings ?? []
const byCode = new Map(rows.map((r) => [r.instrumentCode.toUpperCase(), r]))
/** Mirror MappingEngine.resolve(): instrumentCode OR analyzerCode, case-insensitive. */
const resolve = (label: string): Row | undefined => {
  const u = label.toUpperCase()
  return rows.find(
    (r) => r.instrumentCode.toUpperCase() === u || (r.analyzerCode ?? '').toUpperCase() === u
  )
}
const asRule = (r: Row): MappingRule =>
  ({
    id: r.instrumentCode,
    driverId: 'maglumi-x6',
    instrumentCode: r.instrumentCode,
    instrumentName: r.instrumentName,
    analyzerCode: r.analyzerCode,
    unit: r.unit,
    status: 'manual',
    confidence: 1,
    lisTestId: r.lisTestId,
    lisTestCode: r.lisTestCode,
    lisTestName: r.lisTestName,
    lisParamId: r.lisParamId,
    lisParamName: r.lisParamName,
    updatedAt: ''
  }) as MappingRule

// =============================================================================
console.log(
  '\n[1] Catalog: maglumi-x6 is an ASTM driver like the X3, with every X6 channel in its panel'
)
{
  const drv = getDriver('maglumi-x6')
  ok('driver exists', !!drv)
  if (drv) {
    eq('protocol astm', drv.info.protocol, 'astm')
    eq('default port 9100', drv.info.defaultPort, 9100)
    eq('no ASTM dialect (plain X3 path)', drv.astmDialect, undefined)
    ok('serial transport offered', (drv.info.transports ?? []).includes('serial'))
    const codes = new Set(drv.analytes().map((a) => a.code.toUpperCase()))
    const missing = Object.keys(MAGLUMI_X6_CHANNELS).filter((c) => !codes.has(c))
    ok(
      'every X6 channel code is a panel analyte',
      missing.length === 0,
      `missing ${missing.join(',')}`
    )
    for (const c of ['HAVM', 'CMVM', 'TOXOM', 'RUBM', 'HSV12G', 'HSV12M', 'TTGA'])
      ok(`  X6-only analyte ${c} present`, codes.has(c))
  }
  const x3 = getDriver('maglumi-x3')
  ok(
    'X3 panel does NOT carry the X6-only analytes',
    !!x3 && !x3.analytes().some((a) => a.code === 'HAVM')
  )
  eq(
    'maglumiChannel(x6, PSA) is the on-screen channel',
    maglumiChannel('maglumi-x6', 'psa'),
    'tPSA II'
  )
  eq('maglumiChannel(x3, PSA) unchanged', maglumiChannel('maglumi-x3', 'PSA'), 'PSA')
  eq(
    'maglumiChannel on a non-channel driver is undefined',
    maglumiChannel('magicl-6000i', 'TSH'),
    undefined
  )
}

// =============================================================================
console.log('\n[2] Discovery: the X6 header says "X6 User", never "MAGLUMI"')
{
  const fp = fingerprintInstrument(
    X6_HEADER + CR + 'Q|1|^9432983||ALL||||||||O' + CR + 'L|1|N' + CR
  )
  eq('fingerprint -> maglumi-x6', fp?.driverId, 'maglumi-x6')
  eq('  strong match', fp?.confidence, 0.95)
  eq('  protocol astm', fp?.protocol, 'astm')
  const x3 = fingerprintInstrument('H|\\^&||PSWD| MAGLUMI X3 |||||Lis||P|E1394-97|20180319' + CR)
  eq('X3 header still -> maglumi-x3', x3?.driverId, 'maglumi-x3')
}

// =============================================================================
console.log('\n[3] Real uploads decode through the standard ASTM path')
{
  const proto = new AstmProtocol()
  const msgs = proto.feed(
    Buffer.from(
      upload('9437421', 'R|1|^^^TT3 II|1.22|ng/ml|0.750 - 2.100|N||||||20260921101739|'),
      'latin1'
    )
  )
  eq('one message per upload', msgs.length, 1)
  const res = parseAstm(msgs[0], 'x6')
  eq('one result', res.length, 1)
  const r = res[0]
  eq('  barcode from the O record', r.sampleId, '9437421')
  eq('  analyte = LIS Channel No.', r.analyteCode, 'TT3 II')
  eq('  value', r.value, '1.22')
  eq('  unit as transmitted', r.unit, 'ng/ml')
  eq('  reference range', r.referenceRange, '0.750 - 2.100')
  eq('  flag', r.flag, 'N')
  eq('  measured at', r.measuredAt, '20260921101739')

  // Out-of-range: the X6 puts "<" / ">" in the flag field; the value is the
  // measuring-range limit. Not a ResultFlag, so it must drop rather than crash.
  const hi = parseAstm(
    new AstmProtocol().feed(
      Buffer.from(
        upload('9614579', 'R|1|^^^25-OH VD II|150|ng/mL|30.000 - 100.000|>||||||20260924125239|'),
        'latin1'
      )
    )[0],
    'x6'
  )[0]
  eq('">" flag row keeps its value', hi.value, '150')
  eq('">" is not a LIS flag', hi.flag, undefined)

  // Every channel/unit pair seen on the wire in the capture resolves to a preset row.
  const seen: Array<[string, string]> = [
    ['TT4 II', 'ug/dL'],
    ['TSH II', 'uIU/mL'],
    ['TT3 II', 'ng/ml'],
    ['PSA', 'ng/mL'],
    ['TEST II', 'ng/dL'],
    ['25-OH VD II', 'ng/mL'],
    ['Vit B12 III', 'pg/mL'],
    ['PRL II', 'ng/mL'],
    ['CEA II', 'ng/mL'],
    ['FSH II', 'mIU/mL'],
    ['LH II', 'mIU/mL'],
    ['FT4 II', 'ng/L'],
    ['FT3 II', 'pg/mL'],
    ['ANA II', 'AU/mL'],
    ['AFP II', 'IU/mL'],
    ['HBsAg Quant', 'IU/mL'],
    ['Anti-HCV II', 'AU/mL'],
    ['HIV Combi', 'AU/mL'],
    ['PROG II', 'ng/mL'],
    ['IgE II', 'IU/mL'],
    ['HAV IgM', 'AU/mL'],
    ['Ferritin II', 'ng/mL']
  ]
  for (const [label, unit] of seen) {
    const row = resolve(label)
    ok(`upload "${label}" resolves to a preset row`, !!row, 'no row')
    if (row) eq(`  ${label}: preset x6Unit matches the wire`, row._evidence?.x6Unit, unit)
  }
  // Superseded generations: old labels that must still file, and ones that must not.
  eq('old-generation "TSH" resolves to the TSH row', resolve('TSH')?.instrumentCode, 'TSH')
  eq('old-generation "T3" resolves to the T3 row', resolve('T3')?.instrumentCode, 'T3')
  eq('old-generation "TEST" (ng/mL) matches nothing', resolve('TEST'), undefined)
  eq('old-generation "CCP" matches nothing', resolve('CCP'), undefined)
  eq('"Vit B12 II" (a=1.5) matches nothing', resolve('Vit B12 II'), undefined)
  eq('hidden "Rubella IgM_Mc" matches nothing', resolve('Rubella IgM_Mc'), undefined)
}

// =============================================================================
console.log('\n[4] Units: wire values reach Noble unchanged except the old-generation T3')
{
  const conv = (label: string, value: string, unit: string): { value: string; unit?: string } => {
    const row = resolve(label)
    if (!row) throw new Error(`no row for ${label}`)
    const result = {
      id: 'r',
      instrumentId: 'x6',
      sampleId: '1',
      analyteCode: label,
      analyteName: label,
      value,
      unit,
      receivedAt: ''
    } as CanonicalResult
    return convertForLis(result, asRule(row))
  }
  eq('FT4 II 14.5 ng/L -> 14.5 (Noble ng/L)', conv('FT4 II', '14.5', 'ng/L').value, '14.5')
  eq('TEST II 611 ng/dL -> 611 (Noble ng/dL)', conv('TEST II', '611', 'ng/dL').value, '611')
  eq('TT3 II 1.22 ng/ml -> 1.22 (Noble ng/mL)', conv('TT3 II', '1.22', 'ng/ml').value, '1.22')
  eq(
    'AFP II 0.879 IU/mL -> 0.879 (IU/mL, AFP ng/mL rule must not fire)',
    conv('AFP II', '0.879', 'IU/mL').value,
    '0.879'
  )
  eq('25-OH VD II 9.09 ng/mL -> 9.09', conv('25-OH VD II', '9.09', 'ng/mL').value, '9.09')
  eq(
    'Anti-HCV II 0.52 AU/mL -> 0.52 (S/CO field, no numeric change)',
    conv('Anti-HCV II', '0.52', 'AU/mL').value,
    '0.52'
  )
  const t3old = conv('T3', '122', 'ng/dL')
  eq('old-generation T3 122 ng/dL -> 1.22 ng/mL', t3old.value, '1.22')
  eq('  labelled ng/mL', t3old.unit, 'ng/mL')
}

// =============================================================================
console.log('\n[5] Host query: the real Q is answered with the byte-identical eLab order')
{
  const q = ENQ + STX + [X6_HEADER, 'Q|1|^9437421||ALL||||||||O', 'L|1|N'].join(CR) + CR + ETX + EOT
  const msg = new AstmProtocol().feed(Buffer.from(q, 'latin1'))[0]
  const query = extractAstmQuery(msg)
  eq('SID extracted', query?.sid, '9437421')
  eq('analyzer name captured', query?.analyzerName, 'X6 User')
  // What the mapping engine would order for a T3/T4/TSH request: the channel names.
  const codes = ['T3', 'T4', 'TSH'].map((c) => byCode.get(c)?.analyzerCode ?? c)
  const frames = frameAstmSimple(buildAstmOrderRecords('9437421', codes))
  eq('one simple frame', frames.length, 1)
  const expected =
    STX +
    'H|\\^&||PSWD| MAGLUMI X3 |||||Lis||P|E1394-97|20180319' +
    CR +
    'P|1' +
    CR +
    'O|1|9437421||^^^TT3 II\\^^^TT4 II\\^^^TSH II|R' +
    CR +
    'L|1|N' +
    CR +
    ETX
  eq(
    'order bytes == eLab "Send Message To Machine" line (2026-09-21 09:53:46)',
    frames[0].toString('latin1'),
    expected
  )
  // A manually diluted re-run is queried with a suffixed SID; it is not a barcode.
  const dil = extractAstmQuery(
    new AstmProtocol().feed(
      Buffer.from(
        ENQ +
          STX +
          [X6_HEADER, 'Q|1|^9457510 dil||ALL||||||||O', 'L|1|N'].join(CR) +
          CR +
          ETX +
          EOT,
        'latin1'
      )
    )[0]
  )
  eq(
    '"9457510 dil" query is passed through verbatim (not filed as 9457510)',
    dil?.sid,
    '9457510 dil'
  )
}

// =============================================================================
console.log('\n[6] Preset: srinagar.json X6 rows are complete, unique and channel-addressed')
{
  ok('Srinagar preset has an X6 entry', !!inst)
  eq('serial listed first (eLab ran on COM6)', inst?.transports?.[0], 'serial')
  eq(
    'every X6 channel has a preset row',
    Object.keys(MAGLUMI_X6_CHANNELS)
      .filter((c) => !byCode.has(c))
      .join(','),
    ''
  )
  eq(
    'no preset row outside the X6 channel table',
    rows
      .filter((r) => !MAGLUMI_X6_CHANNELS[r.instrumentCode.toUpperCase()])
      .map((r) => r.instrumentCode)
      .join(','),
    ''
  )
  const codes = rows.map((r) => r.instrumentCode.toUpperCase())
  ok('no duplicate instrument codes', new Set(codes).size === codes.length)
  const badChannel = rows
    .filter((r) => r.analyzerCode !== MAGLUMI_X6_CHANNELS[r.instrumentCode.toUpperCase()])
    .map((r) => r.instrumentCode)
  ok('analyzerCode equals the channel table', badChannel.length === 0, badChannel.join(','))
  ok(
    'every row is manual with a Noble test id and name',
    rows.every((r) => r.status === 'manual' && typeof r.lisTestId === 'number' && !!r.lisTestName)
  )
  ok(
    'param rows carry the param name (Noble labels rows by parameter)',
    rows.filter((r) => r.lisParamId != null).every((r) => !!r.lisParamName)
  )
  const targets = rows.map((r) => `${r.lisTestId}/${r.lisParamId ?? '-'}`)
  const dup = targets.filter((t, i) => targets.indexOf(t) !== i)
  ok('no two rows share a Noble target (duplicate-channel hazard)', dup.length === 0, dup.join(','))
  eq('mappingsSummary.total matches', inst?.mappingsSummary?.total, rows.length)
  // Site-specific targets that name-matching would get wrong.
  eq('Anti-CCP -> Kashmir CLIA row ACPCL1', byCode.get('ACCP')?.lisTestCode, 'ACPCL1')
  eq('ANA -> CLIA param anacl02 under ANACL01', byCode.get('ANA')?.lisParamId, 5424)
  eq('PTH -> param A608 under BI161', byCode.get('PTH')?.lisParamId, 608)
  eq('IgE -> param A568 under BI133', byCode.get('IGE')?.lisParamId, 568)
  eq('HBsAg -> CLIA row HBSCL, not the rapid card MS056', byCode.get('HBSAG')?.lisTestCode, 'HBSCL')
  eq(
    'Anti-HCV -> CLIA row hcvcl, not the rapid card MS058',
    byCode.get('HCV')?.lisTestCode,
    'hcvcl'
  )
  eq('HIV -> CLIA row HIVCL, not the rapid card MS066', byCode.get('HIV')?.lisTestCode, 'HIVCL')
  eq('FT4 target unit ng/L (Noble field)', byCode.get('FT4')?.unit, 'ng/L')
  eq('Testosterone target unit ng/dL', byCode.get('TESTO')?.unit, 'ng/dL')
}

// =============================================================================
console.log('\n' + '='.repeat(64))
console.log(`RESULT: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFAILURES:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All Srinagar MAGLUMI X6 checks passed.')
