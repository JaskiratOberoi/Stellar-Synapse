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
import { extractAstmQueries, extractAstmQuery } from '../src/main/core/drivers/parsing'
import {
  AGAPPE_CX4_CHEM,
  buildAgappeCx4AstmSample,
  buildAgappeCx4BatchOrderFrames,
  buildAgappeCx4OrderFrames,
  buildAgappeCx4OrderRecords,
  cx4ReferenceRange,
  cx4SampleId,
  frameAgappeCx4Record,
  parseAgappeCx4Astm
} from '../src/main/core/drivers/agappeCx4'
import { getDriver } from '../src/main/core/drivers/registry'
import { fingerprintInstrument } from '../src/main/core/discovery/fingerprint'
import { cx4RetireUnknownItemRows, cx4StockNameMigrationRows } from '../src/main/core/mapping/MappingEngine'
import type { MappingRule, PresetMapping } from '../src/shared/types'
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
  // The orchestrator answers EVERY query of a batch (handleCx4BatchQuery), so
  // the extractor must surface all four with their full specimen ids.
  const qs = extractAstmQueries(batch)
  eq('extractAstmQueries: 4 queries', qs.length, 4)
  eq('batch specimens in order', qs.map((q) => q.specimen).join(' '), '^11^2^11^N ^12^2^12^N ^13^2^13^N ^14^2^14^N')
  eq('single-query extractor = first of batch', extractAstmQuery(batch)?.specimen, '^11^2^11^N')

  // Batch REPLY: ONE session — H, then P|n + O|1..k per tube, then L — with
  // continuous frame numbers (the layout a production LIS was captured using,
  // section [B]); a tube with nothing to order keeps its P record.
  const reply = buildAgappeCx4BatchOrderFrames(
    [
      { specimen: '128123^1^1^1^N', codes: ['ALT', 'AST'] },
      { specimen: '^12^2^12^N', codes: [] },
      { specimen: '1281234^2^1^2^N', codes: ['ALT', 'ALB'] }
    ],
    '20090119100425'
  ).map(printable)
  eq('batch reply: 9 frames (H P O O P P O O L)', reply.length, 9)
  eq(
    'one header, live form (sender, receiver, processing id, timestamp)',
    reply[0].replace(/\[ETX\][0-9A-F]{2}/, '[ETX]'),
    '[STX]1H|\\^&|||Synapse|||||Host||1|20090119100425[CR][ETX][CR][LF]'
  )
  eq('tube 1: P|1', reply[1], '[STX]2P|1|||||||||||||[CR][ETX]8B[CR][LF]')
  eq('tube 2 (nothing to order): lone P|2', reply[4], '[STX]5P|2|||||||||||||[CR][ETX]8F[CR][LF]')
  eq('tube 3: P|3 then O|1 restarts at 1', reply[5], '[STX]6P|3|||||||||||||[CR][ETX]91[CR][LF]')
  eq(
    'tube 3 O|1 ALT carries frame 7',
    reply[6],
    '[STX]7O|1|1281234^2^1^2^N||^^^ALT|R|20090119100425|||||||||1||||||||||O[CR][ETX]32[CR][LF]'
  )
  eq('frame numbers roll 7 -> 0 across tubes', reply[7].slice(0, 6), '[STX]0')
  eq('one terminator', reply[8], '[STX]1L|1|N[CR][ETX]04[CR][LF]')
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
  // O and L frames are the manual's byte-for-byte. H and P take the form the
  // production capture (section [B]) proved: the manual's bare `H|\^&` and
  // `P|1|||||||||||||^` were never seen accepted (Lucknow took no order from
  // them, 2026-10-05 and 2026-10-12).
  const expected = [
    '[STX]1H|\\^&|||Synapse|||||Host||1|20090119100534[CR][ETX]',
    '[STX]2P|1|||||||||||||[CR][ETX]8B[CR][LF]',
    '[STX]3O|1|3977777^4^1^1^N||^^^AST|R|20090119100534|||||||||1||||||||||O[CR][ETX]51[CR][LF]',
    '[STX]4O|2|3977777^4^1^1^N||^^^TP|R|20090119100534|||||||||1||||||||||O[CR][ETX]0F[CR][LF]',
    '[STX]5O|3|3977777^4^1^1^N||^^^ALB|R|20090119100534|||||||||1||||||||||O[CR][ETX]3C[CR][LF]',
    '[STX]6L|1|N[CR][ETX]09[CR][LF]'
  ]
  eq('6 frames (H P O O O L)', frames.length, 6)
  eq('frame 1: header in the live form', printable(frames[0]).startsWith(expected[0]), true)
  frames.slice(1).forEach((f, i) => eq(`frame ${i + 2} matches ${i === 0 ? 'the live P' : 'manual'}`, printable(f), expected[i + 1]))
  // Single query = batch of one: identical bytes.
  eq(
    'single reply == batch reply for one tube',
    frames.map(printable).join(''),
    buildAgappeCx4BatchOrderFrames([{ specimen: '3977777^4^1^1^N', codes: ['AST', 'TP', 'ALB'] }], '20090119100534')
      .map(printable)
      .join('')
  )

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
      ['GLU', 'GLU(HK)'],
      ['CRT-J', 'E-CRE'],
      ['TBIL', 'TB-V'],
      ['DBIL', 'DB-V'],
      ['Ca', 'Ca(ARS)'],
      ['PHOS', 'PHOS-S'],
      ['ALP-IFCC', 'ALP'],
      ['GLU', 'GLU-H']
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
console.log('\n[L] Live capture — Lucknow CX4 via Agappe LIS emulator, 2026-10-05 14:51')
{
  // Verbatim from the emulator log (sample 2, barcode 99011223): sender/receiver
  // "1", stock item names, "***" placeholders, ranges "lo^hi\^".
  const LIVE = [
    '[STX]1H|\\^&|||1|||||1||1|20261005145112[CR][ETX]8A[CR][LF]',
    '[STX]2P|1|||||||Male||||||^Y[CR][ETX]C1[CR][LF]',
    '[STX]3O|1|99011223^2^1^2|||R|20261005105222|||||||||1||||||||||O[CR][ETX]B7[CR][LF]',
    '[STX]4R|1|^^^TC|190.0|mg/dl|0^200\\^|N||F||||20261005105222[CR][ETX]3D[CR][LF]',
    '[STX]5R|2|^^^TG|222.8|mg/dl|60^165\\^|H||F||||20261005105222[CR][ETX]81[CR][LF]',
    '[STX]6R|3|^^^UREA|12.80|mg/dl|10^50\\^|N||F||||20261005105222[CR][ETX]DC[CR][LF]',
    '[STX]7R|4|^^^E-CRE|***|mg/dl|0.6^1.1\\^|A||F||||20261005105222[CR][ETX]D3[CR][LF]',
    '[STX]0R|5|^^^UA|3.1|mg/dl|3.5^7.5\\^|L||F||||20261005105222[CR][ETX]42[CR][LF]',
    '[STX]1R|6|^^^AST|***|U/L|0^35\\^|A||F||||20261005110353[CR][ETX]DD[CR][LF]',
    '[STX]2R|7|^^^ALT|39.1|U/L|0^45\\^|N||F||||20261005105222[CR][ETX]32[CR][LF]',
    '[STX]3R|8|^^^ALB|5.1|g/dl|0^0\\^|H||F||||20261005105222[CR][ETX]42[CR][LF]',
    '[STX]4R|9|^^^TP|6.3|g/dl|6^8\\^|N||F||||20261005105222[CR][ETX]30[CR][LF]',
    '[STX]5R|10|^^^TBIL|0.1|mg/dl|0^1.2\\^|N||F||||20261005105222[CR][ETX]98[CR][LF]',
    '[STX]6R|11|^^^DBIL|0.01|mg/dl|0^0.4\\^|N||F||||20261005105222[CR][ETX]BB[CR][LF]',
    '[STX]7R|12|^^^ALP|***|U/L|80^306\\^|A||F||||20261005105222[CR][ETX]6D[CR][LF]',
    '[STX]0R|13|^^^ALP-IFCC|68.0|U/L|40^129\\^|N||F||||20261005105222[CR][ETX]03[CR][LF]',
    '[STX]1R|14|^^^GGT|0.6|U/L|10^45\\^|L||F||||20261005105222[CR][ETX]58[CR][LF]',
    '[STX]2R|15|^^^Ca|12.3|mg/dl|8.8^10.2\\^|H||F||||20261005105222[CR][ETX]E0[CR][LF]',
    '[STX]3R|16|^^^CRT-J|0.16|mg/dl|0.7^1.4\\^|L||F||||20261005105222[CR][ETX]6C[CR][LF]',
    '[STX]4L|1|N[CR][ETX]07[CR][LF]'
  ]
  // Our framer reproduces every live checksum (so our order frames will pass
  // the analyzer's check too).
  let csOk = 0
  for (const f of LIVE) {
    const m = /^\[STX\](\d)(.*)\[CR\]\[ETX\]([0-9A-F]{2})\[CR\]\[LF\]$/.exec(f)!
    const ours = printable(frameAgappeCx4Record(Number(m[1]), m[2]))
    if (ours === f) csOk++
    else failures.push(`live checksum ${m[2].slice(0, 20)}: ours ${ours.slice(-12)}`)
  }
  eq('all 20 live frame checksums reproduced', csOk, LIVE.length)
  failed += LIVE.length - csOk

  const msg = decodeSession(LIVE)
  eq('20 records decoded', msg.records.length, 20)
  const results = parseAgappeCx4Astm(msg, INSTR)
  const codes = results.map((r) => r.analyteCode)
  eq('13 results filed (16 R records minus three "***")', results.length, 13)
  ok('"***" placeholders dropped (E-CRE, AST, ALP)', !codes.some((c) => ['E-CRE', 'AST', 'ALP'].includes(c)))
  ok('all under barcode 99011223', results.every((r) => r.sampleId === '99011223'))
  const by = Object.fromEntries(results.map((r) => [r.analyteCode, r]))
  eq('TBIL value', by['TBIL']?.value, '0.1')
  eq('CRT-J value', by['CRT-J']?.value, '0.16')
  eq('ALP-IFCC value', by['ALP-IFCC']?.value, '68.0')
  eq('TC range 0^200\\^ -> "0-200"', by['TC']?.referenceRange, '0-200')
  eq('flag H', by['TG']?.flag, 'H')
  eq('unit as sent (mg/dl)', by['Ca']?.unit, 'mg/dl')

  // Every live item is a known driver analyte and, in both site presets, maps
  // to Noble — except the retired twins (E-CRE, ALP) which must be 'ignored'.
  const panel = new Set(AGAPPE_CX4_CHEM.map((x) => x.code))
  // TIBC and GLU-H joined the wire in the Lucknow Synapse logs 4-8 Oct 2026
  // (both as "***" so far: TIBC uncalibrated, GLU-H no reagent).
  const liveCodes = ['TC', 'TG', 'UREA', 'E-CRE', 'UA', 'AST', 'ALT', 'ALB', 'TP', 'TBIL', 'DBIL', 'ALP', 'ALP-IFCC', 'GGT', 'Ca', 'CRT-J', 'GLU', 'TIBC', 'GLU-H']
  eq('every live item is in the driver panel', liveCodes.filter((c) => !panel.has(c)).join(','), '')
  for (const [site, preset] of [['delhi', delhi], ['lucknow', lucknow]] as const) {
    const rows = (preset.instruments as Array<{ driverId: string; mappings?: Row[] }>).find(
      (i) => i.driverId === 'agappe-mispa-cx4'
    )?.mappings ?? []
    const row = (c: string) => rows.find((r) => r.instrumentCode === c)
    const unfiled = liveCodes
      .filter((c) => !['E-CRE', 'ALP', 'GLU-H'].includes(c))
      .filter((c) => row(c)?.status !== 'manual' || !row(c)?.lisTestId)
    eq(`${site}: every live item maps to Noble`, unfiled.join(','), '')
    eq(`${site}: E-CRE retired`, row('E-CRE')?.status, 'ignored')
    eq(`${site}: ALP retired in favour of ALP-IFCC`, row('ALP')?.status, 'ignored')
    eq(`${site}: GLU-H retired in favour of GLU`, row('GLU-H')?.status, 'ignored')
    eq(`${site}: TIBC -> Noble BI138 (t136)`, `${row('TIBC')?.lisTestCode}/${row('TIBC')?.lisTestId}`, 'BI138/136')
    for (const gone of ['TB', 'DB', 'CRE', 'CRE-E', 'GLU(OX)', 'Ca(CPC)', 'LPS', 'Fe', 'HS-CRP']) {
      ok(`${site}: manual-only name ${gone} no longer in the preset`, !row(gone))
    }
  }
}

// =============================================================================
console.log('\n[S] Lucknow Sample Register item list (screen, 2026-10-08): nothing can fall through')
{
  // Every item the unit's software lists (black = reagent loaded, grey = not),
  // read off the Sample Register screen. The serum indices L/H/I are never
  // uploaded as results.
  const SCREEN = [
    'GLU-H', 'TC', 'TG', 'HDL-C', 'LDL-C', 'UREA', 'E-CRE', 'UA', 'AST', 'ALT', 'GLU', 'ALB', 'TP',
    'TBIL', 'DBIL', 'ALP', 'ALP-IFCC', 'AMY', 'GGT', 'LDH', 'PHOS', 'Ca', 'Mg', 'CK', 'ASO', 'CRP',
    'RF', 'HbA1c', 'MALB', 'U-HS-CRP', 'IgA', 'IgE', 'IgG', 'IgM', 'Lp(a)', 'C3', 'C4', 'APO A1',
    'APO B', 'CER', 'CYS-C', 'PA', 'FER', 'CRT-J', 'Lipase', 'IRON MONO', 'TIBC'
  ]
  const LOADED = [
    'GLU-H', 'TC', 'TG', 'HDL-C', 'LDL-C', 'UREA', 'E-CRE', 'UA', 'AST', 'ALT', 'GLU', 'ALB', 'TP',
    'TBIL', 'DBIL', 'ALP', 'ALP-IFCC', 'AMY', 'GGT', 'LDH', 'PHOS', 'Ca', 'Mg', 'CRP', 'RF',
    'CRT-J', 'Lipase', 'TIBC'
  ]
  // Deliberately unmapped (documented in _notMapped): unit mismatch or owned
  // by another analyzer. Everything else on the screen must have a preset row.
  const DOCUMENTED = new Set(['HbA1c', 'IgE', 'IgM', 'C3', 'C4', 'APO A1', 'APO B', 'ASO', 'PA', 'CER'])
  const panel = new Set(AGAPPE_CX4_CHEM.map((x) => x.code.toUpperCase()))
  eq(
    'every screen item is a driver panel analyte (case-insensitive)',
    SCREEN.filter((c) => !panel.has(c.toUpperCase())).join(','),
    ''
  )
  for (const [site, preset] of [['delhi', delhi], ['lucknow', lucknow]] as const) {
    const rows = (preset.instruments as Array<{ driverId: string; mappings?: Row[] }>).find(
      (i) => i.driverId === 'agappe-mispa-cx4'
    )?.mappings ?? []
    const row = (c: string) => rows.find((r) => r.instrumentCode.toUpperCase() === c.toUpperCase())
    eq(
      `${site}: every screen item has a preset row or a _notMapped entry`,
      SCREEN.filter((c) => !row(c) && !DOCUMENTED.has(c)).join(','),
      ''
    )
    const liveTwins = new Set(['GLU-H', 'E-CRE', 'ALP'])
    eq(
      `${site}: every reagent-loaded item is mapped (twins retired)`,
      LOADED.filter((c) => (liveTwins.has(c) ? row(c)?.status !== 'ignored' : row(c)?.status !== 'manual' || !row(c)?.lisTestId)).join(','),
      ''
    )
  }
}

// =============================================================================
console.log('\n[B] Live bidirectional batch — analyzer HOST log 2026-08-27 (Bindu Logic LIS broker)')
{
  // The analyzer's own HOST debug log ("Machine Comm file.txt"): operator ran
  // "S. Barcode Scan" over 17 tubes, the analyzer sent H + 17 Q + L in one
  // session, and the LIS answered in ONE session with the frames below. Every
  // ordered item was then run and uploaded (e.g. 2608016757: E-CRE, GLU, TP,
  // ALT, ALB at 13:08), so this is a layout the CX4 software accepts.
  const LIVE_BATCH = [
    '[STX]1H|\\^&|||MISPA|||||Host||1|20260827122638[CR][ETX]53[CR][LF]',
    '[STX]2P|1|||||||||||||[CR][ETX]8B[CR][LF]',
    '[STX]3O|1|2608016829^^1^1^N||^^^GLU|R|20260827122638|||||||||1||||||||||O[CR][ETX]B6[CR][LF]',
    '[STX]4P|2|||||||||||||[CR][ETX]8E[CR][LF]',
    '[STX]5O|1|2608016807^^1^2^N||^^^TBIL|R|20260827122638|||||||||1||||||||||O[CR][ETX]F8[CR][LF]',
    '[STX]6O|2|2608016807^^1^2^N||^^^ALT|R|20260827122638|||||||||1||||||||||O[CR][ETX]B0[CR][LF]',
    '[STX]7P|3|||||||||||||[CR][ETX]92[CR][LF]',
    '[STX]0O|1|2608016298^^1^3^N||^^^GLU|R|20260827122638|||||||||1||||||||||O[CR][ETX]B5[CR][LF]',
    '[STX]1P|4|||||||||||||[CR][ETX]8D[CR][LF]',
    '[STX]2O|1|2608016772^^1^4^N||^^^IgE|R|20260827122638|||||||||1||||||||||O[CR][ETX]C2[CR][LF]',
    '[STX]3P|5|||||||||||||[CR][ETX]90[CR][LF]',
    '[STX]4O|1|2608016881^^1^5^N||^^^IgE|R|20260827122638|||||||||1||||||||||O[CR][ETX]C6[CR][LF]',
    '[STX]5P|6|||||||||||||[CR][ETX]93[CR][LF]',
    '[STX]6O|1|2608016811^^1^6^N||^^^GLU|R|20260827122638|||||||||1||||||||||O[CR][ETX]B5[CR][LF]',
    '[STX]7O|2|2608016811^^1^6^N||^^^E-CRE|R|20260827122638|||||||||1||||||||||O[CR][ETX]1B[CR][LF]',
    '[STX]0O|3|2608016811^^1^6^N||^^^CRP|R|20260827122638|||||||||1||||||||||O[CR][ETX]AE[CR][LF]',
    '[STX]1P|7|||||||||||||[CR][ETX]90[CR][LF]',
    '[STX]2O|1|2608016952^^1^7^N||^^^IgE|R|20260827122638|||||||||1||||||||||O[CR][ETX]C5[CR][LF]',
    '[STX]3P|8|||||||||||||[CR][ETX]93[CR][LF]',
    '[STX]4O|1|2608016810^^1^8^N||^^^IgE|R|20260827122638|||||||||1||||||||||O[CR][ETX]C1[CR][LF]',
    '[STX]5P|9|||||||||||||[CR][ETX]96[CR][LF]',
    '[STX]6O|1|2608016659^^1^9^N||^^^IgE|R|20260827122638|||||||||1||||||||||O[CR][ETX]CF[CR][LF]',
    '[STX]7P|10|||||||||||||[CR][ETX]C0[CR][LF]',
    '[STX]0O|1|2608016684^^1^10^N||^^^IgE|R|20260827122638|||||||||1||||||||||O[CR][ETX]EF[CR][LF]',
    '[STX]1P|11|||||||||||||[CR][ETX]BB[CR][LF]',
    '[STX]2O|1|2608016883^^1^11^N||^^^IgE|R|20260827122638|||||||||1||||||||||O[CR][ETX]F3[CR][LF]',
    '[STX]3P|12|||||||||||||[CR][ETX]BE[CR][LF]',
    '[STX]4O|1|2608016757^^1^12^N||^^^E-CRE|R|20260827122638|||||||||1||||||||||O[CR][ETX]4D[CR][LF]',
    '[STX]5O|2|2608016757^^1^12^N||^^^GLU|R|20260827122638|||||||||1||||||||||O[CR][ETX]EB[CR][LF]',
    '[STX]6O|3|2608016757^^1^12^N||^^^TP|R|20260827122638|||||||||1||||||||||O[CR][ETX]A9[CR][LF]',
    '[STX]7O|4|2608016757^^1^12^N||^^^ALT|R|20260827122638|||||||||1||||||||||O[CR][ETX]E8[CR][LF]',
    '[STX]0O|5|2608016757^^1^12^N||^^^ALB|R|20260827122638|||||||||1||||||||||O[CR][ETX]D0[CR][LF]',
    '[STX]1P|13|||||||||||||[CR][ETX]BD[CR][LF]',
    '[STX]2O|1|2608016705^^1^13^N||^^^ALB|R|20260827122638|||||||||1||||||||||O[CR][ETX]C8[CR][LF]',
    '[STX]3O|2|2608016705^^1^13^N||^^^E-CRE|R|20260827122638|||||||||1||||||||||O[CR][ETX]47[CR][LF]',
    '[STX]4O|3|2608016705^^1^13^N||^^^ALT|R|20260827122638|||||||||1||||||||||O[CR][ETX]DE[CR][LF]',
    '[STX]5O|4|2608016705^^1^13^N||^^^GLU|R|20260827122638|||||||||1||||||||||O[CR][ETX]E7[CR][LF]',
    '[STX]6P|14|||||||||||||[CR][ETX]C3[CR][LF]',
    '[STX]7O|1|2608016766^^1^14^N||^^^E-CRE|R|20260827122638|||||||||1||||||||||O[CR][ETX]52[CR][LF]',
    '[STX]0O|2|2608016766^^1^14^N||^^^GLU|R|20260827122638|||||||||1||||||||||O[CR][ETX]E8[CR][LF]',
    '[STX]1O|3|2608016766^^1^14^N||^^^ALT|R|20260827122638|||||||||1||||||||||O[CR][ETX]E3[CR][LF]',
    '[STX]2P|15|||||||||||||[CR][ETX]C0[CR][LF]',
    '[STX]3O|1|2608016780^^1^15^N||^^^E-CRE|R|20260827122638|||||||||1||||||||||O[CR][ETX]4B[CR][LF]',
    '[STX]4O|2|2608016780^^1^15^N||^^^GLU|R|20260827122638|||||||||1||||||||||O[CR][ETX]E9[CR][LF]',
    '[STX]5P|16|||||||||||||[CR][ETX]C4[CR][LF]',
    '[STX]6O|1|2608016818^^1^16^N||^^^TP|R|20260827122638|||||||||1||||||||||O[CR][ETX]A9[CR][LF]',
    '[STX]7O|2|2608016818^^1^16^N||^^^ALT|R|20260827122638|||||||||1||||||||||O[CR][ETX]E8[CR][LF]',
    '[STX]0O|3|2608016818^^1^16^N||^^^ALB|R|20260827122638|||||||||1||||||||||O[CR][ETX]D0[CR][LF]',
    '[STX]1O|4|2608016818^^1^16^N||^^^GLU|R|20260827122638|||||||||1||||||||||O[CR][ETX]EB[CR][LF]',
    '[STX]2O|5|2608016818^^1^16^N||^^^E-CRE|R|20260827122638|||||||||1||||||||||O[CR][ETX]51[CR][LF]',
    '[STX]3P|17|||||||||||||[CR][ETX]C3[CR][LF]',
    '[STX]4O|1|2608016943^^1^17^N||^^^CRP|R|20260827122638|||||||||1||||||||||O[CR][ETX]E8[CR][LF]',
    '[STX]5O|2|2608016943^^1^17^N||^^^GLU|R|20260827122638|||||||||1||||||||||O[CR][ETX]ED[CR][LF]',
    '[STX]6O|3|2608016943^^1^17^N||^^^IgE|R|20260827122638|||||||||1||||||||||O[CR][ETX]FC[CR][LF]',
    '[STX]7O|4|2608016943^^1^17^N||^^^E-CRE|R|20260827122638|||||||||1||||||||||O[CR][ETX]55[CR][LF]',
    '[STX]0L|1|N[CR][ETX]03[CR][LF]'
  ]
  // Every live checksum reproduces through our framer.
  let csOk = 0
  for (const f of LIVE_BATCH) {
    const m = /^\[STX\](\d)(.*)\[CR\]\[ETX\]([0-9A-F]{2})\[CR\]\[LF\]$/.exec(f)!
    if (printable(frameAgappeCx4Record(Number(m[1]), m[2])) === f) csOk++
    else failures.push(`live batch checksum ${m[2].slice(0, 24)}`)
  }
  eq('all 56 live frame checksums reproduced', csOk, LIVE_BATCH.length)
  failed += LIVE_BATCH.length - csOk

  // The analyzer's 17 queries, in order (its own H + Q×17 + L session).
  const LIVE_QUERIES = [
    '2608016829^^1^1^N', '2608016807^^1^2^N', '2608016298^^1^3^N', '2608016772^^1^4^N',
    '2608016881^^1^5^N', '2608016811^^1^6^N', '2608016952^^1^7^N', '2608016810^^1^8^N',
    '2608016659^^1^9^N', '2608016684^^1^10^N', '2608016883^^1^11^N', '2608016757^^1^12^N',
    '2608016705^^1^13^N', '2608016766^^1^14^N', '2608016780^^1^15^N', '2608016818^^1^16^N',
    '2608016943^^1^17^N'
  ]
  // What the LIS ordered per tube, read back from its O records.
  const orders = new Map<string, string[]>()
  for (const f of LIVE_BATCH) {
    const o = /\dO\|\d+\|([^|]+)\|\|\^\^\^([^|]+)\|/.exec(f)
    if (o) orders.set(o[1], [...(orders.get(o[1]) ?? []), o[2]])
  }
  const groups = LIVE_QUERIES.map((specimen) => ({ specimen, codes: orders.get(specimen) ?? [] }))
  eq('17 tubes, 37 orders', `${groups.length}/${groups.reduce((n, g) => n + g.codes.length, 0)}`, '17/37')
  eq('barcode is component 1 of every live specimen id', cx4SampleId(LIVE_QUERIES[11]), '2608016757')

  // Our batch reply for the same 17 queries, with the live LIS's header names,
  // is the live session byte-for-byte — all 56 frames.
  const ours = buildAgappeCx4BatchOrderFrames(groups, '20260827122638', { sender: 'MISPA', receiver: 'Host' }).map(printable)
  eq('same frame count as the live session', ours.length, LIVE_BATCH.length)
  const diff = ours.map((f, i) => (f === LIVE_BATCH[i] ? null : i + 1)).filter((x) => x != null)
  eq('all 56 frames identical to the live LIS reply', diff.join(','), '')
  // Default names when the query carried none.
  eq(
    'default header names',
    buildAgappeCx4BatchOrderFrames(groups.slice(0, 1), '20260827122638').map(printable)[0].slice(0, 48),
    '[STX]1H|\\^&|||Synapse|||||Host||1|20260827122638'
  )

  // Second session, query 4 (2608015162, pos 21): the LIS had nothing for it
  // and sent a lone P|4 between P|3's orders and P|5's — the builder does the same.
  const second = buildAgappeCx4BatchOrderFrames(
    [
      { specimen: '2608016664^^1^20^N', codes: ['E-CRE', 'ALT'] },
      { specimen: '2608015162^^1^21^N', codes: [] },
      { specimen: '2608017048^^1^22^N', codes: ['IgE', 'GLU'] }
    ],
    '20260827124012'
  ).map(printable)
  eq('empty tube keeps its P record', second[4], '[STX]5P|2|||||||||||||[CR][ETX]8F[CR][LF]')
  eq(
    'next tube O|1 matches the live frame text',
    second[6].replace(/^\[STX\]\d/, '').replace(/\[ETX\][0-9A-F]{2}/, '[ETX]'),
    'O|1|2608017048^^1^22^N||^^^IgE|R|20260827124012|||||||||1||||||||||O[CR][ETX][CR][LF]'
  )
}

// =============================================================================
console.log('\n[M] Migration: Lucknow v0.6.13 store -> stock item names (cx4StockNameMigrationRows)')
{
  // The install as the Lucknow logs show it: the 2026-09-23 preset rows under
  // the manual's names, plus what the auto-mapper did with the stock names it
  // met ("Ca" -> CA 72.4, TBIL -> standalone BI048, GLU -> BI114) and the ones
  // it could not resolve at all (DBIL unmapped; CRT-J / ALP-IFCC / TIBC / GLU-H
  // had no rule).
  const DRV = 'agappe-mispa-cx4'
  const rule = (
    instrumentCode: string,
    status: MappingRule['status'],
    t?: { id: number; code: string; name: string; pid?: number; pname?: string },
    unit = 'mg/dL'
  ): MappingRule => ({
    id: `r-${instrumentCode}`,
    driverId: DRV,
    instrumentCode,
    instrumentName: instrumentCode,
    status,
    unit,
    lisTestId: t?.id,
    lisTestCode: t?.code,
    lisTestName: t?.name,
    lisParamId: t?.pid,
    lisParamName: t?.pname,
    updatedAt: '2026-10-04T17:35:31.047Z'
  })
  const BIL = { id: 87, code: 'BI046', name: 'Bilirubin (Total Direct & Indirect )' }
  const store: MappingRule[] = [
    rule('ALT', 'manual', { id: 79, code: 'BI014', name: 'Alanine amino Transferase - (ALT / SGPT)' }, 'U/L'),
    rule('ALP', 'manual', { id: 279, code: 'BI023', name: 'Alkaline Phosphatase (ALP)' }, 'U/L'),
    rule('TB', 'manual', { ...BIL, pid: 431, pname: 'Bilirubin Total' }),
    rule('DB', 'manual', { ...BIL, pid: 430, pname: 'Bilirubin Conjugated' }),
    rule('CRE', 'manual', { id: 114, code: 'BI089', name: 'Creatinine' }),
    rule('CRE-E', 'ignored'),
    rule('GLU(OX)', 'manual', { id: 284, code: 'BI114', name: 'Glucose - Fasting' }),
    rule('Ca(CPC)', 'manual', { id: 96, code: 'BI064', name: 'Calcium' }),
    rule('LPS', 'manual', { id: 139, code: 'BI146', name: 'Lipase' }, 'U/L'),
    rule('Fe', 'manual', { id: 135, code: 'BI137', name: 'Iron' }, 'ug/dL'),
    rule('UIBC', 'manual', { id: 252, code: 'BI222', name: 'Unsaturated Iron Binding Capacity (UIBC)' }, 'ug/dL'),
    rule('HS-CRP', 'manual', { id: 202, code: 'MS067', name: 'hs-CRP', pid: 1549, pname: 'hs-CRP' }, 'mg/L'),
    // what autoMapOnReceive made of the stock names
    rule('Ca', 'auto', { id: 2208, code: 'IMCA', name: 'CA 72.4' }),
    rule('TBIL', 'auto', { id: 89, code: 'BI048', name: 'Bilirubin Total' }),
    rule('GLU', 'auto', { id: 284, code: 'BI114', name: 'Glucose - Fasting' }),
    rule('DBIL', 'unmapped')
  ]
  const preset = (lucknow.instruments as Array<{ driverId: string; mappings?: PresetMapping[] }>).find(
    (i) => i.driverId === DRV
  )?.mappings ?? []
  const rows = cx4StockNameMigrationRows(store, preset)

  // Replay applyPresetMappings: later rows win, by code (case-insensitive).
  const after = new Map<string, { status: string; target: string; code: string }>()
  for (const r of store) after.set(r.instrumentCode.toUpperCase(), { status: r.status, target: `${r.lisTestId ?? '-'}/${r.lisParamId ?? '-'}`, code: r.instrumentCode })
  for (const m of rows) {
    const key = m.instrumentCode.toUpperCase()
    after.set(key, m.status === 'ignored'
      ? { status: 'ignored', target: '', code: m.instrumentCode }
      : { status: 'manual', target: `${m.lisTestId ?? '-'}/${m.lisParamId ?? '-'}`, code: m.instrumentCode })
  }
  const at = (c: string) => after.get(c.toUpperCase())
  eq('Ca: junk CA 72.4 auto-row replaced by Calcium BI064', `${at('Ca')?.status} ${at('Ca')?.target}`, 'manual 96/-')
  eq('TBIL: standalone BI048 auto-row replaced by the composite p431', `${at('TBIL')?.status} ${at('TBIL')?.target}`, 'manual 87/431')
  eq('DBIL: unmapped row now the composite p430', `${at('DBIL')?.status} ${at('DBIL')?.target}`, 'manual 87/430')
  eq('GLU: keeps BI114 (now manual)', `${at('GLU')?.status} ${at('GLU')?.target}`, 'manual 284/-')
  eq('CRT-J: created from CRE', `${at('CRT-J')?.status} ${at('CRT-J')?.target}`, 'manual 114/-')
  eq('ALP-IFCC: created from ALP', `${at('ALP-IFCC')?.status} ${at('ALP-IFCC')?.target}`, 'manual 279/-')
  eq('Lipase: created from LPS', `${at('Lipase')?.status} ${at('Lipase')?.target}`, 'manual 139/-')
  eq('IRON MONO: created from Fe', `${at('IRON MONO')?.status} ${at('IRON MONO')?.target}`, 'manual 135/-')
  eq('U-HS-CRP: created from HS-CRP', `${at('U-HS-CRP')?.status} ${at('U-HS-CRP')?.target}`, 'manual 202/1549')
  eq('TIBC: backfilled from the preset', `${at('TIBC')?.status} ${at('TIBC')?.target}`, 'manual 136/-')
  eq('GLU-H: backfilled as retired', at('GLU-H')?.status, 'ignored')
  eq('E-CRE: retired under its real name', at('E-CRE')?.status, 'ignored')
  for (const old of ['TB', 'DB', 'CRE', 'GLU(OX)', 'Ca(CPC)', 'ALP', 'LPS', 'Fe', 'HS-CRP', 'CRE-E']) {
    eq(`${old}: retired`, at(old)?.status, 'ignored')
  }
  eq('UIBC: untouched (operator-owned row)', `${at('UIBC')?.status} ${at('UIBC')?.target}`, 'manual 252/-')
  const live = [...after.values()].filter((v) => v.status === 'manual')
  const targets = live.map((v) => v.target)
  const dups = targets.filter((t, i) => targets.indexOf(t) !== i)
  eq('no two live rows share a Noble target after migration', dups.join(','), '')
  const presetLive = preset.filter((m) => m.status === 'manual' && m.lisTestId != null).map((m) => m.instrumentCode)
  eq(
    'every preset-mapped item is live on the migrated install',
    presetLive.filter((c) => at(c)?.status !== 'manual').join(','),
    ''
  )
  // Idempotence: a second pass over the migrated store changes nothing.
  const migrated: MappingRule[] = [...after.entries()].map(([, v]) =>
    rule(v.code, v.status as MappingRule['status'], v.status === 'manual'
      ? { id: Number(v.target.split('/')[0]), code: 'X', name: 'x', pid: v.target.split('/')[1] === '-' ? undefined : Number(v.target.split('/')[1]) }
      : undefined)
  )
  eq('second pass is a no-op', cx4StockNameMigrationRows(migrated, preset).length, 0)

  // Lucknow 2026-10-12: after the rename migration the host query STILL ordered
  // CRE, CRE-E, E-CRE, K and Na (the Synapse log warned "4 channels map to the
  // same LIS test (CRE, CRE-E, CRT-J, E-CRE)") — rows an operator had set to
  // manual survive the rename, and the ISE trio was live from the preset. The
  // analyzer took none of the orders. cx4RetireUnknownItemRows retires them.
  const CREA = { id: 114, code: 'BI089', name: 'Creatinine' }
  const lucknow1012: MappingRule[] = [
    ...migrated.filter((r) => !['CRE', 'CRE-E', 'E-CRE', 'K', 'Na', 'Cl', 'ALP'].includes(r.instrumentCode)),
    rule('CRE', 'manual', CREA),
    rule('CRE-E', 'manual', CREA),
    rule('E-CRE', 'manual', CREA),
    rule('ALP', 'manual', { id: 279, code: 'BI023', name: 'Alkaline Phosphatase (ALP)' }, 'U/L'),
    rule('K', 'manual', { id: 297, code: 'BI174', name: 'Potassium' }, 'mmol/L'),
    rule('Na', 'manual', { id: 157, code: 'BI205', name: 'Sodium' }, 'mmol/L'),
    rule('Cl', 'manual', { id: 101, code: 'BI074', name: 'Chloride - Serum' }, 'mmol/L')
  ]
  // What the Lucknow unit has uploaded with a value (E-CRE, ALP, GLU-H, TIBC only ever "***").
  const seen = new Set(['TC', 'TG', 'UREA', 'UA', 'AST', 'ALT', 'ALB', 'TP', 'TBIL', 'DBIL', 'ALP-IFCC', 'GGT', 'CA', 'CRT-J', 'GLU'])
  const retired = cx4RetireUnknownItemRows(lucknow1012, seen)
  eq(
    'retires the manual-name twins, the ISE trio, plain ALP and E-CRE',
    retired.map((r) => r.instrumentCode).sort().join(','),
    'ALP,CRE,CRE-E,Cl,E-CRE,K,Na'
  )
  ok('every retiring row is ignored', retired.every((r) => r.status === 'ignored'))
  // A unit that HAS uploaded potassium keeps its ISE rows; one running the
  // enzymatic creatinine kit keeps E-CRE.
  const withIse = cx4RetireUnknownItemRows(lucknow1012, new Set([...seen, 'K', 'NA', 'CL', 'E-CRE']))
  eq('ISE + E-CRE kept when the unit has reported them', withIse.map((r) => r.instrumentCode).sort().join(','), 'ALP,CRE,CRE-E')
  eq('retire pass is a no-op on the current preset list', cx4RetireUnknownItemRows(
    preset.map((m) => rule(m.instrumentCode, m.status === 'ignored' ? 'ignored' : 'manual', m.lisTestId != null ? { id: m.lisTestId, code: m.lisTestCode ?? '', name: m.lisTestName ?? '', pid: m.lisParamId } : undefined, m.unit)),
    seen
  ).length, 0)
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
