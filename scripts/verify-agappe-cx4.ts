/**
 * Agappe Mispa CX4 <-> manual parity verification.
 *
 * Replays the frames printed in the Mispa CX4 user manual (REV.09-2017,
 * Appendix E "LIS Communication Setup Instructions" v1.1, Examples 1-3) through
 * Synapse's production code (AstmProtocol decoder + agappeCx4 driver + host-query
 * extraction) and asserts that results, queries and the order download come out
 * byte-for-byte as the manual specifies — including its printed checksums.
 *
 * Run:  npm run verify:agappe-cx4
 */
import { AstmProtocol } from '../src/main/core/protocols/astm'
import { extractAstmQuery } from '../src/main/core/drivers/parsing'
import {
  AGAPPE_CX4_CHEM,
  buildAgappeCx4AstmSample,
  buildAgappeCx4OrderFrames,
  buildAgappeCx4OrderRecords,
  cx4ReferenceRange,
  cx4SampleId,
  frameAgappeCx4Record,
  parseAgappeCx4Astm
} from '../src/main/core/drivers/agappeCx4'
import { getDriver } from '../src/main/core/drivers/registry'
import { fingerprintInstrument } from '../src/main/core/discovery/fingerprint'
import delhi from '../presets/delhi.json'
import lucknow from '../presets/lucknow.json'

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
  ok(
    name,
    actual === expected,
    `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
  )
}

/** Convert the manual's printable control tokens into real wire bytes. */
function wire(printable: string): Buffer {
  const map: Record<string, number> = {
    ENQ: 0x05,
    STX: 0x02,
    ETX: 0x03,
    EOT: 0x04,
    ACK: 0x06,
    CR: 0x0d,
    LF: 0x0a
  }
  const out = printable.replace(/\[(ENQ|STX|ETX|EOT|ACK|CR|LF)\]/g, (_, t: string) =>
    String.fromCharCode(map[t])
  )
  return Buffer.from(out, 'latin1')
}

/** Render wire bytes back as the manual's printable form (for failure messages). */
function printable(buf: Buffer): string {
  const names: Record<number, string> = {
    0x05: '[ENQ]',
    0x02: '[STX]',
    0x03: '[ETX]',
    0x04: '[EOT]',
    0x06: '[ACK]',
    0x0d: '[CR]',
    0x0a: '[LF]'
  }
  let s = ''
  for (const b of buf) s += names[b] ?? String.fromCharCode(b)
  return s
}

/** Feed a full analyzer session (ENQ, frames, EOT) and return the one decoded message. */
function decodeSession(frames: string[]) {
  const proto = new AstmProtocol()
  const msgs = proto.feed(wire(`[ENQ]${frames.join('')}[EOT]`))
  if (msgs.length !== 1) throw new Error(`expected 1 message, got ${msgs.length}`)
  return msgs[0]
}

const INSTR = 'test-cx4'

// =============================================================================
console.log('\n[1] Frame checksums match the manual (CR before ETX, mod-256 over FN..ETX)')
{
  // Appendix E, Example 3 (host -> CX4) and Example 1 (CX4 -> host).
  eq(
    '1H|\\^& -> E5',
    printable(frameAgappeCx4Record(1, 'H|\\^&')),
    '[STX]1H|\\^&[CR][ETX]E5[CR][LF]'
  )
  eq(
    '2P|1|||||||||||||^ -> E9',
    printable(frameAgappeCx4Record(2, 'P|1|||||||||||||^')),
    '[STX]2P|1|||||||||||||^[CR][ETX]E9[CR][LF]'
  )
  eq('6L|1|N -> 09', printable(frameAgappeCx4Record(6, 'L|1|N')), '[STX]6L|1|N[CR][ETX]09[CR][LF]')
  // The manual prints "24" for the Example 1 result header, but that checksum
  // only holds for the ORIGINAL Dirui sender name "CS-400" — Agappe's manual is
  // a search-and-replace of the CS-400 host manual ("CX4" sums 136 less, giving
  // 9C). This pins both: the algorithm reproduces the printed value with the
  // original text, and the CX4 spelling yields the arithmetically correct one.
  eq(
    '1H|...CS-400...Host -> 24 (manual, original Dirui sender)',
    printable(frameAgappeCx4Record(1, 'H|\\^&|||CS-400|||||Host||1|20090119131415')),
    '[STX]1H|\\^&|||CS-400|||||Host||1|20090119131415[CR][ETX]24[CR][LF]'
  )
  eq(
    '1H|...CX4...Host -> 9C (same frame, CX4 spelling)',
    printable(frameAgappeCx4Record(1, 'H|\\^&|||CX4|||||Host||1|20090119131415')),
    '[STX]1H|\\^&|||CX4|||||Host||1|20090119131415[CR][ETX]9C[CR][LF]'
  )
  eq(
    '4R|1|^^^ALT -> 32 (result record)',
    printable(frameAgappeCx4Record(4, 'R|1|^^^ALT|-2|U/L|^\\^|N||F||||20090119123027')),
    '[STX]4R|1|^^^ALT|-2|U/L|^\\^|N||F||||20090119123027[CR][ETX]32[CR][LF]'
  )
  eq(
    '2Q|1|^130^5^45^N -> B4 (query record)',
    printable(frameAgappeCx4Record(2, 'Q|1|^130^5^45^N||ALL||||||||O')),
    '[STX]2Q|1|^130^5^45^N||ALL||||||||O[CR][ETX]B4[CR][LF]'
  )
  eq(
    '3O|1|128123^1^1^2 -> 55 (result order)',
    printable(frameAgappeCx4Record(3, 'O|1|128123^1^1^2|||R|20090119123027|||||||||1||||||||||O')),
    '[STX]3O|1|128123^1^1^2|||R|20090119123027|||||||||1||||||||||O[CR][ETX]55[CR][LF]'
  )
  eq(
    'frame number rolls 7 -> 0',
    printable(frameAgappeCx4Record(8, 'L|1|N')).slice(0, 7),
    '[STX]0L'
  )
}

// =============================================================================
console.log('\n[2] Result upload (Appendix E, Example 1) -> canonical results')
{
  const msg = decodeSession([
    '[STX]1H|\\^&|||CX4|||||Host||1|20090119131415[CR][ETX]24[CR][LF]',
    '[STX]2P|1|||||||||||||^[CR][ETX]E9[CR][LF]',
    '[STX]3O|1|128123^1^1^2|||R|20090119123027|||||||||1||||||||||O[CR][ETX]55[CR][LF]',
    '[STX]4R|1|^^^ALT|-2|U/L|^\\^|N||F||||20090119123027[CR][ETX]32[CR][LF]',
    '[STX]5R|2|^^^AST|1|U/L|^\\^|N||F||||20090119123027[CR][ETX]0D[CR][LF]',
    '[STX]6R|3|^^^ALB|-8.57|g/l|^\\^|N||F||||20090119123027[CR][ETX]F6[CR][LF]',
    '[STX]7L|1|N[CR][ETX]0A[CR][LF]'
  ])
  eq('7 records decoded (H P O R R R L)', msg.records.length, 7)
  const results = parseAgappeCx4Astm(msg, INSTR)
  const by = Object.fromEntries(results.map((r) => [r.analyteCode, r]))
  eq('count = 3', results.length, 3)
  ok(
    'all filed under barcode 128123 (O-3 component 1)',
    results.every((r) => r.sampleId === '128123')
  )
  eq('ALT value', by['ALT']?.value, '-2')
  eq('AST value', by['AST']?.value, '1')
  eq('ALB value', by['ALB']?.value, '-8.57')
  eq('ALT unit', by['ALT']?.unit, 'U/L')
  eq('ALB unit (as sent)', by['ALB']?.unit, 'g/l')
  eq('flag N', by['ALT']?.flag, 'N')
  eq('empty range placeholder ^\\^ -> undefined', by['ALT']?.referenceRange, undefined)
  eq('completion time from field 13', by['ALT']?.measuredAt, '20090119123027')
}

// =============================================================================
console.log('\n[3] Result record variants (Appendix E field tables)')
{
  // R example: R|1|^^^GGT|4.96|mg/dL|3^12\0^20|N||F||||20081124151012
  const msg = decodeSession([
    '[STX]1H|\\^&|||CX4|||||Host||1|20081124151206[CR][ETX]00[CR][LF]',
    '[STX]2P|1||||ZhangDongdong|||M||||||40^Y[CR][ETX]00[CR][LF]',
    '[STX]3O|1|CA2201320078^^1^10^N|||R|20081124151012|||||||||1||||||||||O[CR][ETX]00[CR][LF]',
    '[STX]4R|1|^^^GGT|4.96|mg/dL|3^12\\0^20|H||F||||20081124151012[CR][ETX]00[CR][LF]',
    '[STX]5R|2|^^^GLU(HK)|98|mg/dL|70^100\\40^400|L||C||||20081124151013[CR][ETX]00[CR][LF]',
    '[STX]6L|1|N[CR][ETX]00[CR][LF]'
  ])
  const results = parseAgappeCx4Astm(msg, INSTR)
  eq('count = 2', results.length, 2)
  eq('ID-mode barcode CA2201320078', results[0]?.sampleId, 'CA2201320078')
  eq('normal range 3^12 -> "3-12" (critical range dropped)', results[0]?.referenceRange, '3-12')
  eq('flag H', results[0]?.flag, 'H')
  eq('parenthesised item code GLU(HK) preserved', results[1]?.analyteCode, 'GLU(HK)')
  eq('flag L', results[1]?.flag, 'L')
  eq('corrected (C) result still imported', results[1]?.value, '98')

  // "Sample No." mode: O-3 = ^<S.No>^<Disk>^<Pos>^<Dil> — no barcode.
  const sno = decodeSession([
    '[STX]1H|\\^&|||CX4|||||Host||1|20081124151206[CR][ETX]00[CR][LF]',
    '[STX]2O|1|^1^1^10^N|||R|20081124151012|||||||||1||||||||||O[CR][ETX]00[CR][LF]',
    '[STX]3R|1|^^^TP|7.1|g/dL|^\\^|N||F||||20081124151012[CR][ETX]00[CR][LF]',
    '[STX]4L|1|N[CR][ETX]00[CR][LF]'
  ])
  const r = parseAgappeCx4Astm(sno, INSTR)
  eq('S.No mode files under a non-barcode label', r[0]?.sampleId, 'SNO-1')

  // QC upload ("Send QC Result To LIS", Dirui protocol v1.1 "Control result"):
  // control name^lot in O field 4, no barcode, Westgard flag. Must be skipped —
  // it is not a patient result — while a patient block in the same session
  // still parses.
  const qc = decodeSession([
    '[STX]1H|\\^&||| Analyzer |||||Host||1|20110104172413[CR][ETX]00[CR][LF]',
    '[STX]2P|1||||QC|||||||^[CR][ETX]00[CR][LF]',
    '[STX]3O|1|^0^1^^|LANDOX-1^2333^|||20110104172413|||||||||1||||||||||O[CR][ETX]00[CR][LF]',
    '[STX]4R|1|^^^ALT|333|U/L|2^22|1-3s|>+3SD|||||20110104172413[CR][ETX]00[CR][LF]',
    '[STX]5O|2|555555^2^1^3^N|||R|20110104172500|||||||||1||||||||||O[CR][ETX]00[CR][LF]',
    '[STX]6R|1|^^^ALT|31|U/L|^\\^|N||F||||20110104172500[CR][ETX]00[CR][LF]',
    '[STX]7L|1|N[CR][ETX]00[CR][LF]'
  ])
  const qcResults = parseAgappeCx4Astm(qc, INSTR)
  eq('QC block skipped, patient block kept', qcResults.length, 1)
  eq('patient result filed under its barcode', qcResults[0]?.sampleId, '555555')
  eq('patient value', qcResults[0]?.value, '31')

  eq('cx4ReferenceRange("^\\^")', cx4ReferenceRange('^\\^'), undefined)
  eq('cx4ReferenceRange("")', cx4ReferenceRange(''), undefined)
  eq('cx4ReferenceRange("0^20")', cx4ReferenceRange('0^20'), '0-20')
}

// =============================================================================
console.log('\n[4] Host query (Appendix E, Example 2 + Q field table)')
{
  // ID mode (Q field table example). Note the literal space in field 4.
  const idMode = decodeSession([
    '[STX]1H|\\^&|||CX4|||||Host||1|20090119131335[CR][ETX]25[CR][LF]',
    '[STX]2Q|1|AC2201023321^^0^1^N| |ALL||||||||O[CR][ETX]00[CR][LF]',
    '[STX]3L|1|N[CR][ETX]06[CR][LF]'
  ])
  const q = extractAstmQuery(idMode)
  ok('query detected', !!q)
  eq('generic sid = barcode', q?.sid, 'AC2201023321')
  eq('specimen field preserved verbatim', q?.specimen, 'AC2201023321^^0^1^N')
  eq('cx4SampleId = component 1', cx4SampleId(q?.specimen), 'AC2201023321')
  eq('analyzer name from H-5', q?.analyzerName, 'CX4')

  // S.No mode (Example 2 "Single"): the generic extractor would take "130"
  // (the running sample number) — the CX4 path must NOT look that up.
  const snoMode = decodeSession([
    '[STX]1H|\\^&|||CX4|||||Host||1|20090119131335[CR][ETX]25[CR][LF]',
    '[STX]2Q|1|^130^5^45^N||ALL||||||||O[CR][ETX]B4[CR][LF]',
    '[STX]3L|1|N[CR][ETX]06[CR][LF]'
  ])
  const q2 = extractAstmQuery(snoMode)
  eq('generic sid would be the sample number', q2?.sid, '130')
  eq('cx4SampleId is empty in S.No mode (no barcode)', cx4SampleId(q2?.specimen), '')

  // Batch query (Example 2 "Batch"): four Q records in one session — the first
  // is what the generic extractor answers; assert it decodes cleanly.
  const batch = decodeSession([
    '[STX]1H|\\^&|||CX4|||||Host||1|20090119131335[CR][ETX]25[CR][LF]',
    '[STX]2Q|1|^11^2^11^N||ALL||||||||O[CR][ETX]78[CR][LF]',
    '[STX]3Q|2|^12^2^12^N||ALL||||||||O[CR][ETX]7C[CR][LF]',
    '[STX]4Q|3|^13^2^13^N||ALL||||||||O[CR][ETX]80[CR][LF]',
    '[STX]5Q|4|^14^2^14^N||ALL||||||||O[CR][ETX]84[CR][LF]',
    '[STX]6L|1|N[CR][ETX]09[CR][LF]'
  ])
  eq('batch query: 6 records', batch.records.length, 6)
  eq('batch query: 4 Q records', batch.records.filter((r) => r[0] === 'Q').length, 4)
}

// =============================================================================
console.log('\n[5] Order download (Appendix E, Example 3 "Sample ID mode, Single") byte-for-byte')
{
  // HOST -> CX4 for barcode 3977777 (S.No 4, disk 1, pos 1): AST, TP, ALB.
  const frames = buildAgappeCx4OrderFrames(
    '3977777^4^1^1^N',
    ['AST', 'TP', 'ALB'],
    '20090119100534'
  )
  const expected = [
    '[STX]1H|\\^&[CR][ETX]E5[CR][LF]',
    '[STX]2P|1|||||||||||||^[CR][ETX]E9[CR][LF]',
    '[STX]3O|1|3977777^4^1^1^N||^^^AST|R|20090119100534|||||||||1||||||||||O[CR][ETX]51[CR][LF]',
    '[STX]4O|2|3977777^4^1^1^N||^^^TP|R|20090119100534|||||||||1||||||||||O[CR][ETX]0F[CR][LF]',
    '[STX]5O|3|3977777^4^1^1^N||^^^ALB|R|20090119100534|||||||||1||||||||||O[CR][ETX]3C[CR][LF]',
    '[STX]6L|1|N[CR][ETX]09[CR][LF]'
  ]
  eq('6 frames (H P O O O L)', frames.length, 6)
  frames.forEach((f, i) => eq(`frame ${i + 1} matches manual`, printable(f), expected[i]))

  // Example 3 "Batch", 2nd session: 128123^1^1^1^N with ALT + AST at 20090119100417.
  const b = buildAgappeCx4OrderFrames('1281234^2^1^2^N', ['ALT', 'ALB'], '20090119100425')
  eq(
    'batch O|1 ALT -> 2E',
    printable(b[2]),
    '[STX]3O|1|1281234^2^1^2^N||^^^ALT|R|20090119100425|||||||||1||||||||||O[CR][ETX]2E[CR][LF]'
  )
  eq(
    'batch O|2 ALB -> 1E',
    printable(b[3]),
    '[STX]4O|2|1281234^2^1^2^N||^^^ALB|R|20090119100425|||||||||1||||||||||O[CR][ETX]1E[CR][LF]'
  )
  eq('batch L -> 08 (frame 5)', printable(b[4]), '[STX]5L|1|N[CR][ETX]08[CR][LF]')

  // O record field layout (26 fields: specimen descriptor in 16, report type in 26).
  const recs = buildAgappeCx4OrderRecords('X^^0^1^N', ['GGT'], '20090119100534')
  const o = recs[2].split('|')
  eq('O record has 26 fields', o.length, 26)
  eq('O-3 specimen echoed', o[2], 'X^^0^1^N')
  eq('O-5 universal test id', o[4], '^^^GGT')
  eq('O-6 priority R', o[5], 'R')
  eq('O-16 specimen descriptor = 1 (serum)', o[15], '1')
  eq('O-26 report type = O', o[25], 'O')

  // Frame-number rollover on a long panel: H P + 8 O + L = 11 frames -> 1..7,0,1,2,3.
  const long = buildAgappeCx4OrderFrames('9^^0^1^N', [
    'ALT',
    'AST',
    'ALP',
    'GGT',
    'TB',
    'DB',
    'TP',
    'ALB'
  ])
  eq('11 frames for 8 tests', long.length, 11)
  eq(
    'frame numbers roll over 7 -> 0',
    long.map((f) => String.fromCharCode(f[1])).join(''),
    '12345670123'
  )
}

// =============================================================================
console.log('\n[6] Round-trip: simulator upload -> decoder -> parser')
{
  const sample = buildAgappeCx4AstmSample('S123456', AGAPPE_CX4_CHEM.slice(0, 6))
  const frames = sample.split('\r').map((rec, i) => printable(frameAgappeCx4Record(i + 1, rec)))
  const results = parseAgappeCx4Astm(decodeSession(frames), INSTR)
  eq('round-trip result count = 6', results.length, 6)
  ok(
    'round-trip barcode',
    results.every((r) => r.sampleId === 'S123456')
  )
  ok(
    'round-trip codes preserved',
    ['ALT', 'AST', 'ALP', 'GGT', 'TB', 'DB'].every((c) => results.some((r) => r.analyteCode === c))
  )
  ok(
    'round-trip ranges rendered low-high',
    results.every((r) => /^[\d.]+-[\d.]+$/.test(r.referenceRange ?? ''))
  )
}

// =============================================================================
console.log('\n[7] Driver registration, dialect wiring, discovery fingerprint')
{
  const d = getDriver('agappe-mispa-cx4')
  ok('CX4 driver registered', !!d)
  eq('astmDialect = agappe-cx4', d?.astmDialect, 'agappe-cx4')
  eq('protocol = astm', d?.info.protocol, 'astm')
  eq('mode = bidirectional', d?.info.mode, 'bidirectional')
  ok('serial transport offered first', d?.info.transports[0] === 'serial')
  eq('analyte panel size', d?.analytes().length, AGAPPE_CX4_CHEM.length)
  ok(
    'panel codes unique',
    new Set(AGAPPE_CX4_CHEM.map((x) => x.code)).size === AGAPPE_CX4_CHEM.length
  )
  ok(
    'driver.parse routes to the CX4 dialect',
    (() => {
      const msg = decodeSession([
        '[STX]1H|\\^&|||CX4|||||Host||1|20090119131415[CR][ETX]24[CR][LF]',
        '[STX]2O|1|77777^1^1^2|||R|20090119123027|||||||||1||||||||||O[CR][ETX]00[CR][LF]',
        '[STX]3R|1|^^^GLU(OX)|100.5|mg/dL|70^100\\^|H||F||||20090119123027[CR][ETX]00[CR][LF]',
        '[STX]4L|1|N[CR][ETX]00[CR][LF]'
      ])
      const r = d!.parse(msg, INSTR)
      return (
        r.length === 1 &&
        r[0].sampleId === '77777' &&
        r[0].value === '100.5' &&
        r[0].referenceRange === '70-100'
      )
    })()
  )
  ok(
    'driver.buildSample emits a CX4-shaped upload',
    /^H\|\\\^&\|\|\|CX4\|/.test(d!.buildSample('S1', AGAPPE_CX4_CHEM.slice(0, 2)))
  )

  const fp = fingerprintInstrument(
    'H|\\^&|||CX4|||||Host||1|20090119131415\rP|1|||||||||||||^\rL|1|N'
  )
  eq('fingerprint -> agappe-mispa-cx4', fp?.driverId, 'agappe-mispa-cx4')
  eq('fingerprint protocol astm', fp?.protocol, 'astm')
}

// =============================================================================
console.log('\n[8] Delhi + Lucknow presets: CX4 rows are sane and identical')
{
  type Row = {
    instrumentCode: string
    status?: string
    unit?: string
    lisTestId?: number
    lisParamId?: number
    lisTestCode?: string
  }
  const rowsOf = (p: {
    instruments: Array<{
      driverId: string
      mappings?: Row[]
      serial?: Record<string, unknown>
      transports?: string[]
    }>
  }) => p.instruments.find((i) => i.driverId === 'agappe-mispa-cx4')
  const d = rowsOf(delhi as never)
  const l = rowsOf(lucknow as never)
  ok('Delhi preset has a CX4 entry', !!d)
  ok('Lucknow preset has a CX4 entry', !!l)
  const panel = new Map(AGAPPE_CX4_CHEM.map((x) => [x.code.toUpperCase(), x]))
  for (const [site, inst] of [
    ['delhi', d],
    ['lucknow', l]
  ] as const) {
    if (!inst) continue
    const rows = inst.mappings ?? []
    eq(
      `${site}: serial 19200 8-N-1`,
      JSON.stringify(inst.serial),
      '{"baudRate":19200,"dataBits":8,"parity":"none","stopBits":1}'
    )
    eq(`${site}: transport serial first`, inst.transports?.[0], 'serial')
    const unknown = rows
      .filter((r) => !panel.has(r.instrumentCode.toUpperCase()))
      .map((r) => r.instrumentCode)
    ok(`${site}: every row is a panel item`, unknown.length === 0, `unknown ${unknown.join(',')}`)
    const codes = rows.map((r) => r.instrumentCode.toUpperCase())
    ok(`${site}: no duplicate instrument codes`, new Set(codes).size === codes.length)
    const live = rows.filter((r) => r.status === 'manual')
    const targets = live.map((r) => `${r.lisTestId}/${r.lisParamId ?? '-'}`)
    const dup = targets.filter((t, i) => targets.indexOf(t) !== i)
    ok(
      `${site}: no two live rows share a Noble target (duplicate-channel hazard)`,
      dup.length === 0,
      `dup ${dup.join(',')}`
    )
    ok(
      `${site}: every live row has a lisTestId`,
      live.every((r) => typeof r.lisTestId === 'number')
    )
    const unitMismatch = live
      .filter((r) => r.unit !== panel.get(r.instrumentCode.toUpperCase())?.unit)
      .map((r) => r.instrumentCode)
    ok(
      `${site}: mapped units match the driver panel`,
      unitMismatch.length === 0,
      `mismatch ${unitMismatch.join(',')}`
    )
    // Exactly one live member per duplicate-reagent pair.
    for (const pair of [
      ['GLU(OX)', 'GLU(HK)'],
      ['CRE', 'CRE-E'],
      ['TB', 'TB-V'],
      ['DB', 'DB-V'],
      ['Ca(CPC)', 'Ca(ARS)'],
      ['PHOS', 'PHOS-S']
    ]) {
      const n = pair.filter((c) => live.some((r) => r.instrumentCode === c)).length
      eq(`${site}: one live channel for ${pair.join('/')}`, n, 1)
    }
  }
  if (d && l) {
    const strip = (r: Row) =>
      JSON.stringify([r.instrumentCode, r.status, r.unit, r.lisTestId, r.lisTestCode, r.lisParamId])
    eq(
      'Delhi and Lucknow CX4 mapping lists are identical',
      (d.mappings ?? []).map(strip).join('\n'),
      (l.mappings ?? []).map(strip).join('\n')
    )
  }
}

// =============================================================================
console.log('\n' + '='.repeat(64))
console.log(`RESULT: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\nFAILURES:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('All Mispa CX4 <-> manual parity checks passed.')
