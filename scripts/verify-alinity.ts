/**
 * Abbott Alinity ci-series <-> "LIS Interface Manual (HL7)" 80000455-106 parity.
 *
 * Replays every worked example in the manual's Appendix A through Synapse's
 * production code — the MLLP decoder, the abbott-law parser, the query receipt,
 * the order download (positive and negative), the order-response parser and the
 * acknowledgments — and compares our outbound messages to the manual's printed
 * ones field by field (timestamps, GUIDs and AWOS ids normalised). No live
 * Alinity capture exists yet; when one does, add its raw frames here.
 *
 * Run:  npm run verify:alinity
 */
import { Hl7Protocol } from '../src/main/core/protocols/hl7'
import {
  alinityAwosId,
  alinityControlId,
  alinityFlag,
  alinityMessageType,
  alinityNeedsAck,
  buildAlinityAck,
  buildAlinityHl7Sample,
  buildAlinityOrderDownload,
  buildAlinityQueryResponse,
  extractAlinityAssays,
  extractAlinityExceptions,
  parseAlinityHl7,
  parseAlinityObxId,
  parseAlinityOrderResponse,
  parseAlinityQuery
} from '../src/main/core/drivers/abbottAlinity'
import { getDriver } from '../src/main/core/drivers/registry'
import { fingerprintInstrument } from '../src/main/core/discovery/fingerprint'

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
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

const VT = '\x0b'
const FS = '\x1c'
const CR = '\r'
/** <SB>segments<EB><CR>, segments CR-terminated, as the analyzer frames them. */
const mllp = (segs: string[]): Buffer => Buffer.from(VT + segs.join(CR) + CR + FS + CR, 'utf8')
const decode = (segs: string[]) => {
  const msgs = new Hl7Protocol().feed(mllp(segs))
  if (msgs.length !== 1) throw new Error(`expected 1 decoded message, got ${msgs.length}`)
  return msgs[0]
}
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
/** Normalise a message for comparison: 14-digit stamps -> TS, GUIDs -> GUID, trailing CR off. */
const norm = (s: string): string =>
  s.replace(/\b\d{14}(?:[+-]\d{4})?\b/g, 'TS').replace(GUID, 'GUID').replace(/\r+$/, '').split(CR).join('\n')

// --- Appendix A, verbatim -----------------------------------------------------
const SPECIMEN_RESULT = [
  'MSH|^~\\&|Alinity ci|Lab2|LIS|MainLab|20160729110006||OUL^R22^OUL_R22|0a3288dc-9274-424e-a5f4-24dfdaf3c883|P|2.5.1|||NE|AL||UNICODE UTF-8|||LAB-29^IHE',
  'SPM|1|||""|||||||P^Patient^HL70369',
  'SAC|||S000501|||||||S5501|1||||1^Position^99ABT~1^Module^99ABT',
  'OBR||ORDER#1||29^B-hCG^99ABT',
  'ORC|SC||||CM',
  'TQ1|||||||||R^Routine^HL70485',
  'OBX|1|ST|29^B-hCG^99ABT|1|343.26|^mIU/mL||""|||F|||||Admin~Admin||Alinity ci-series^Abbott~i00002^Abbott|20160728171023||||||||||RSLT',
  'TCD|29^B-hCG^99ABT||||||||||UNDILUTED^^99ABT',
  'INV|29^^99ABT|NA^Not applicable^HL70383|CA^Calibration^99ABT||||||||||20160728170808|||65105BG51',
  'INV|29-1^^99ABT|NA^Not applicable^HL70383|SR^Single Test Reagent^HL70384|88105^^99ABT||||||||||||65105BG51',
  'NTE|1|Z|Example comment',
  'OBX|2|ST|29.R^B-hCG^99ABT^S_RAW^Raw Supplemental^IHELAW|1|95007|^RLU||""|||F|||||Admin~Admin||Alinity ci-series^Abbott~i00002^Abbott|20160728171023||||||||||RSLT',
  'OBX|3|EI|29.G^B-hCG^99ABT^S_OTHER^Other Supplemental^IHELAW|1|a42bab85-ee0d-4bf4-bf4a-f820fdda2332|||""|||F|||||Admin~Admin||Alinity ci-series^Abbott~i00002^Abbott|20160728171023||||||||||RSLT'
]
const SPECIMEN_RESULT_ACK = [
  'MSH|^~\\&|LIS|MainLab|Alinity ci|Lab2|20160729110007||ACK^R22^ACK|a0e07adb-e5e9-4c45-822f-dba8884031c3|P|2.5.1||||||UNICODE UTF-8|||LAB-29^IHE',
  'MSA|AA|0a3288dc-9274-424e-a5f4-24dfdaf3c883'
]
const SPECIMEN_EXCEPTION = [
  'MSH|^~\\&|Alinity ci|Lab2|LIS|MainLab|20160801140959||OUL^R22^OUL_R22|9f8d1b37-2c8c-4f7a-9540-009b46abb67a|P|2.5.1|||NE|AL||UNICODE UTF-8|||LAB-29^IHE',
  'PID|||15||Smith^Jane^M^^^^L||19990214|F',
  'PV1||N|^ER 2',
  'SPM|1|||""|||||||P^Patient^HL70369',
  'SAC|||SID004|||||||P1000|4||||2^Position^99ABT~1^Module^99ABT',
  'OBR||ABCD15||1218^Chol^99ABT||||||||||||DoctorQ',
  'ORC|SC||||CM',
  'TQ1|||||||||R^Routine^HL70485',
  'OBX|1|CE|1218^Chol^99ABT|1|0000^Unable to process test; no processing module available.^99ABT|||""|||X|||||Admin~Admin||Alinity ci-series^Abbott~11222^Abbott|20160801140914||||||||||RSLT',
  'TCD|1218^Chol^99ABT||||||||||STANDARD^^99ABT',
  'OBX|2|EI|1218.G^Chol^99ABT^S_OTHER^Other Supplemental^IHELAW|1|6f0cebb2-8997-42a3-b65f-04284e83c35a|||""|||X|||||Admin~Admin||Alinity ci-series^Abbott~11222^Abbott|20160801140914||||||||||RSLT'
]
const CONTROL_RESULT = [
  'MSH|^~\\&|Alinity ci|Lab2|LIS|MainLab|20160801141327||OUL^R22^OUL_R22|5828c7c3-69d1-437b-92e7-8ed6865e1d61|P|2.5.1|||NE|AL||UNICODE UTF-8|||LAB-29^IHE',
  'SPM|1|||""|||||||Q^Control specimen^HL70369',
  'SAC|||123BHCG1|||||||T1040|1||||4^Position^99ABT~1^Module^99ABT',
  'INV|123BHCG1^^99ABT|NA^Not applicable^HL70383|CO^Assay Control^HL70384|32123^^99ABT||||||||20201122||||45333DD11',
  'OBR||""||29^B-hCG^99ABT',
  'ORC|SC||||CM',
  'TQ1|||||||||R^Routine^HL70485',
  'OBX|1|ST|29^B-hCG^99ABT|1|310.26|^mIU/mL|300 - 400|RUO^^99ABT|||F|||||Admin~Admin||Alinity ci-series^Abbott~i00002|20160801141345||||||||||RSLT',
  'TCD|29^B-hCG^99ABT||||||||||UNDILUTED^^99ABT'
]
const STATUS_UPDATE = [
  'MSH|^~\\&|Alinity ci|Lab2|LIS|MainLab|20160729151640||OUL^R22^OUL_R22|8066bc65-b5f3-4e30-8d46-ed3bfc7e1469|P|2.5.1|||NE|AL||UNICODE UTF-8|||LAB-29^IHE',
  'SPM|1|||""|||||||P^Patient^HL70369',
  'SAC|||S000501|||||||S5501|1||||21^Position^99ABT~1^Module^99ABT',
  'OBR||ORDER#1005||29^B-hCG^99ABT',
  'ORC|SC||||IP',
  'TQ1|||||||||S^Stat^HL70485',
  'OBX|1|CE|29^B-hCG^99ABT|1|INITIATED^Initiated^99ABT||||||I|||||||Alinity ci-series^Abbott~i00002^Abbott|20160729154722||||||||||STS',
  'TCD|29^B-hCG^99ABT||||||||||1:15^^99ABT'
]
const QUERY = [
  'MSH|^~\\&|||||20160801135944||QBP^Q11^QBP_Q11|1b0f9f1d-03ce-4dcb-8af0-a68c5a873a34|P|2.5.1|||NE|AL||UNICODE UTF-8|||LAB-27^IHE',
  'QPD|WOS^Work Order Step^IHELAW|87|S000507',
  'RCP|I||R^Real Time^HL70394'
]
const QUERY_RESPONSE = [
  'MSH|^~\\&|||||20160801015944||RSP^K11^RSP_K11|e2703c29-8392-48f5-b085-9664475fcfba|P|2.5.1|||NE|AL||UNICODE UTF-8|||LAB-27^IHE',
  'MSA|AA|1b0f9f1d-03ce-4dcb-8af0-a68c5a873a34',
  'QAK|87|OK|WOS^Work Order Step^IHELAW',
  'QPD|WOS^Work Order Step^IHELAW|87|S000507'
]
const ORDER_ACCEPTED = [
  'MSH|^~\\&|LISApp|MainFacility|AlinityApp|LabFacility|20160801103758||OML^O33^OML_O33|7e68205e-a431-464c-afd7-0115b5baf653|P|2.5.1|||NE|AL||UNICODE UTF-8|||LAB-28^IHE',
  'SPM|1|||""|||||||P^Patient^HL70369',
  'SAC|||S000501',
  'ORC|NW||||||||20160801103758',
  'TQ1|1||||||||S^Stat^HL70485',
  'OBR||ORDER#1005||249^TSH^99ABT'
]
const ORL_ACCEPTED = [
  'MSH|^~\\&|AlinityApp|LabFacility|LISApp|MainFacility|20160801103758||ORL^O34^ORL_O42|f6ddc156-9751-43e6-bf74-093777b14ddc|P|2.5.1||||||UNICODE UTF-8|||LAB-28^IHE',
  'MSA|AA|7e68205e-a431-464c-afd7-0115b5baf653',
  'SPM|1|||""|||||||P^Patient^HL70369',
  'SAC|||S000501',
  'ORC|OK|ORDER#1005|||SC'
]
const ORL_REJECTED = [
  'MSH|^~\\&|AlinityApp|LabFacility|LISApp|MainFacility|20160801103902||ORL^O34^ORL_O42|7bd282c5-37ef-4f18-9ffc-c4a1e5c5fe98|P|2.5.1||||||UNICODE UTF-8|||LAB-28^IHE',
  'MSA|AA|b13bff13-ba63-4a50-9cb5-28d3d4df7c97',
  'SPM|1|||""|||||||P^Patient^HL70369',
  'SAC|||S000501',
  'ORC|UA|ORDER#1005|||CA'
]
const NEGATIVE_QUERY = [
  'MSH|^~\\&|SendApp1|SendFac1|ReceiveApp1|ReceiveFac1|20160725022110||OML^O33^OML_O33|d31fa4fa-4c96-409b-a018-d43b78f818cc|P|2.5.1|||NE|AL||UNICODE UTF-8|||LAB-28^IHE',
  'SPM|1|||""|||||||U^Unknown^HL70369',
  'SAC|||02231522041700',
  'ORC|DC||||||||20160725022110'
]
const SSU = [
  'MSH|^~\\&|||||20160920105212||SSU^U03^SSU_U03|2f05d3b1-fa00-41eb-a071-b87e50ef796a|P|2.5.1|||NE|AL||UNICODE UTF-8',
  'EQU|Alinity ci-series^Abbott~SCC11222^Abbott|20160920105212',
  'SAC|||SID003|||||O^In Process^HL70370||P1000|3||||1^Position^99ABT~1^Module^99ABT',
  'SPM|1|||""|||||||P^Patient^HL70369'
]
const NMD = [
  'MSH|^~\\&|Alinity ci|Lab2|LIS|MainLab|20160801141528||NMD^N02^NMD_N02|52518704-8956-468a-84d5-ea45827ecc7b|P|2.5.1|||NE|AL||UNICODE UTF-8',
  'NST|N'
]
const NMD_ACK = [
  'MSH|^~\\&|LIS|MainLab|Alinity ci|Lab2|20160801021528||ACK^N02^ACK|45bd3540-39d1-4500-b3d5-bd668f752dd3|P|2.5.1||||||UNICODE UTF-8',
  'MSA|AA|52518704-8956-468a-84d5-ea45827ecc7b'
]
const TCU = [
  'MSH|^~\\&|||||20170313101034-0500||TCU^U10^TCU_U10|1d675aca-c827-4ce7-b843-a52de7b995dc|P|2.5.1|||NE|AL||UNICODE UTF-8',
  'EQU|Alinity ci-series^Abbott~SCM00181^Abbott|20170313101034',
  'TCC|658^B-hCG^99ABT|658||||||||||||A^Available^99ABT',
  'TCC|488^Estradiol^99ABT|488||||||||||||U^Unavailable^99ABT',
  'TCC|500^Toxo IgM^99ABT|500||||||||||||U^Unavailable^99ABT',
  'TCC|248^TSH^99ABT|248||||||||||||A^Available^99ABT',
  'TCC|66^Folate^99ABT|66||||||||||||A^Available^99ABT',
  'TCC|199^Progest^99ABT|199||||||||||||A^Available^99ABT'
]
const CALIBRATION = [
  'MSH|^~\\&|Alinity ci|Lab2|LIS|MainLab|20160801141038||OUL^R24^OUL_R24|6240dc76-4499-4d07-8e81-bfaf5d5914d6|P|2.5.1|||NE|AL||UNICODE UTF-8',
  'OBR||""||29^B-hCG^99ABT',
  'SPM|1|||""|||||||C^Calibrator^HL70369',
  'SAC|||1234561|||||||C2040|1||||1^Position^99ABT~1^Module^99ABT',
  'OBX|1|ED|29^B-hCG^99ABT|1|^text^json^Base64^eyJ||||||F|||||Admin||Alinity ci-series^Abbott~i00002^Abbott|20160729144852||||||||||RSLT'
]

// =============================================================================
console.log('\n[1] Catalog: the Alinity rides the abbott-law HL7 dialect with a separate order channel')
{
  const ci = getDriver('abbott-alinity-ci')
  ok('driver exists', !!ci)
  if (ci) {
    eq('protocol hl7', ci.info.protocol, 'hl7')
    eq('hl7Dialect abbott-law', ci.hl7Dialect, 'abbott-law')
    eq('bidirectional', ci.info.mode, 'bidirectional')
    eq('separate order channel flagged', ci.info.separateOrderChannel, true)
    eq('listens as TCP server', ci.info.transports.join(','), 'tcp-server')
    eq('vendor Abbott', ci.info.vendor, 'Abbott')
    ok('hl7Dialect not leaked into info', !('hl7Dialect' in (ci.info as object)))
  }
  eq('Alinity c registered', getDriver('abbott-alinity-c')?.hl7Dialect, 'abbott-law')
  eq('Alinity i registered', getDriver('abbott-alinity-i')?.hl7Dialect, 'abbott-law')
  const fp = fingerprintInstrument(SPECIMEN_RESULT.join('\r'))
  eq('fingerprint from a result frame', fp?.driverId, 'abbott-alinity-ci')
  eq('fingerprint protocol hl7', fp?.protocol, 'hl7')
}

// =============================================================================
console.log('\n[2] Specimen result (Appendix A): one primary result, raw/GUID rows skipped')
{
  const msg = decode(SPECIMEN_RESULT)
  eq('message type', alinityMessageType(msg), 'OUL^R22^OUL_R22')
  eq('control id', alinityControlId(msg), '0a3288dc-9274-424e-a5f4-24dfdaf3c883')
  const res = parseAlinityHl7(msg, 'ali')
  eq('exactly one result', res.length, 1)
  eq('  sample id from SAC-3', res[0]?.sampleId, 'S000501')
  eq('  keyed by assay NAME', res[0]?.analyteCode, 'B-hCG')
  eq('  value', res[0]?.value, '343.26')
  eq('  unit from OBX-6.2', res[0]?.unit, 'mIU/mL')
  eq('  "" reference range dropped', res[0]?.referenceRange, undefined)
  eq('  no flag', res[0]?.flag, undefined)
  eq('  measured at OBX-19', res[0]?.measuredAt, '20160728171023')
  eq('driver.parse gives the same', getDriver('abbott-alinity-ci')?.parse(msg, 'ali').length, 1)
  const assays = extractAlinityAssays(msg)
  eq('assay number learned from OBR/OBX', JSON.stringify(assays), JSON.stringify([{ assayNo: '29', name: 'B-hCG', availability: undefined }]))
  eq('no exceptions', extractAlinityExceptions(msg).length, 0)
  ok('needs an ACK', alinityNeedsAck(msg))
  const ack = buildAlinityAck(msg)
  eq('ACK^R22 matches the manual', norm(ack), norm(SPECIMEN_RESULT_ACK.join(CR)))
}

// =============================================================================
console.log('\n[3] OBX-3 identifier forms and OBX-8 flags')
{
  eq('bare number = primary', parseAlinityObxId('0241^ANTI-Hcv^99ABT')?.kind, 'primary')
  eq('  assay number kept with leading zero', parseAlinityObxId('0241^ANTI-Hcv^99ABT')?.assayNo, '0241')
  eq('.I = interpretation', parseAlinityObxId('0241.I^ANTI-Hcv^99ABT')?.kind, 'interpretation')
  eq('.R = raw', parseAlinityObxId('0241.R^ANTI-Hcv^99ABT^S_RAW^Raw Supplemental^IHELAW')?.kind, 'raw')
  eq('.G = guid', parseAlinityObxId('0241.G^ANTI-Hcv^99ABT^S_OTHER^Other Supplemental^IHELAW')?.kind, 'guid')
  eq('non-numeric id rejected', parseAlinityObxId('TSH^TSH^99ABT'), null)
  eq('LOW -> L', alinityFlag('LOW^Low^99ABT'), 'L')
  eq('HIGH -> H', alinityFlag('HIGH^^99ABT'), 'H')
  eq('EXP then HH -> HH', alinityFlag('EXP^^99ABT~HH^^99ABT'), 'HH')
  eq('< off-scale low -> LL', alinityFlag('<^^HL70078'), 'LL')
  eq('RUO alone -> no flag', alinityFlag('RUO^^99ABT'), undefined)
  eq('"" -> no flag', alinityFlag('""'), undefined)

  // A qualitative assay: index as the primary, interpretation as "<name>.I".
  const qual = decode([
    SPECIMEN_RESULT[0],
    'SPM|1|||""|||||||P^Patient^HL70369',
    'SAC|||S000900',
    'OBR||ORDER#9||241^ANTI-Hcv^99ABT',
    'ORC|SC||||CM',
    'OBX|1|ST|241^ANTI-Hcv^99ABT|1|0.08|^S/CO||""|||F|||||Admin~Admin||Alinity ci-series^Abbott~i00002^Abbott|20160728171023||||||||||RSLT',
    'OBX|2|ST|241.I^ANTI-Hcv^99ABT|1|NONREACTIVE|||""|||F|||||Admin~Admin||Alinity ci-series^Abbott~i00002^Abbott|20160728171023||||||||||RSLT',
    'OBX|3|ST|241.R^ANTI-Hcv^99ABT^S_RAW^Raw Supplemental^IHELAW|1|812|^RLU||""|||F|||||Admin~Admin||Alinity ci-series^Abbott~i00002^Abbott|20160728171023||||||||||RSLT'
  ])
  const q = parseAlinityHl7(qual, 'ali')
  eq('qualitative: two results (index + interpretation)', q.map((r) => `${r.analyteCode}=${r.value}`).join(','), 'ANTI-Hcv=0.08,ANTI-Hcv.I=NONREACTIVE')
  eq('  interpretation carries no unit', q[1]?.unit, undefined)
}

// =============================================================================
console.log('\n[4] Exception, control, status update and calibration are recognised and not posted')
{
  const ex = decode(SPECIMEN_EXCEPTION)
  eq('exception: no results', parseAlinityHl7(ex, 'ali').length, 0)
  const exc = extractAlinityExceptions(ex)
  eq('exception extracted', exc.length, 1)
  eq('  sample', exc[0]?.sampleId, 'SID004')
  eq('  assay', `${exc[0]?.assayNo}:${exc[0]?.name}`, '1218:Chol')
  eq('  code', exc[0]?.code, '0000')
  eq('  text', exc[0]?.text, 'Unable to process test; no processing module available.')
  eq('  assay still learned', extractAlinityAssays(ex)[0]?.assayNo, '1218')

  const ctl = decode(CONTROL_RESULT)
  eq('control (SPM-11 Q): no results', parseAlinityHl7(ctl, 'ali').length, 0)
  eq('control: no exceptions', extractAlinityExceptions(ctl).length, 0)
  ok('control still ACKed', alinityNeedsAck(ctl))

  const sts = decode(STATUS_UPDATE)
  eq('status update (OBX-29 STS): no results', parseAlinityHl7(sts, 'ali').length, 0)
  eq('status update: INITIATED is not an exception', extractAlinityExceptions(sts).length, 0)
  ok('status update ACKed', alinityNeedsAck(sts))

  const cal = decode(CALIBRATION)
  eq('calibration OUL^R24: no results', parseAlinityHl7(cal, 'ali').length, 0)
  ok('calibration ACKed', alinityNeedsAck(cal))
  eq('  as ACK^R24 without a profile id', norm(buildAlinityAck(cal)).split('\n')[0], 'MSH|^~\\&|LIS|MainLab|Alinity ci|Lab2|TS||ACK^R24^ACK|GUID|P|2.5.1||||||UNICODE UTF-8')
}

// =============================================================================
console.log('\n[5] Order query (LAB-27): QBP^Q11 decoded, RSP^K11 matches the manual')
{
  const msg = decode(QUERY)
  const q = parseAlinityQuery(msg)
  ok('query recognised', !!q)
  eq('  barcode from QPD-3', q?.sid, 'S000507')
  eq('  query tag', q?.queryTag, '87')
  eq('  control id', q?.controlId, '1b0f9f1d-03ce-4dcb-8af0-a68c5a873a34')
  ok('a result is not a query', parseAlinityQuery(decode(SPECIMEN_RESULT)) === null)
  ok('a query is not ACKed (it gets RSP^K11)', !alinityNeedsAck(msg))
  if (q) eq('RSP^K11 matches the manual', norm(buildAlinityQueryResponse(q)), norm(QUERY_RESPONSE.join(CR)))
}

// =============================================================================
console.log('\n[6] Order download (LAB-28): OML^O33 matches the manual; ORL^O34 decodes')
{
  const peer = { sendingApp: 'AlinityApp', sendingFacility: 'LabFacility', receivingApp: 'LISApp', receivingFacility: 'MainFacility' }
  const oml = buildAlinityOrderDownload({
    sid: 'S000501',
    tests: [{ assayNo: '249', name: 'TSH', awosId: 'ORDER#1005', priority: 'S' }],
    peer,
    stamp: '20160801103758'
  })
  eq('OML^O33 (one STAT test) matches the manual', norm(oml), norm(ORDER_ACCEPTED.join(CR)))
  const two = buildAlinityOrderDownload({ sid: 'S1', tests: [{ assayNo: '249', name: 'TSH' }, { assayNo: '29', name: 'B-hCG' }] })
  ok('an OML with no known peer names us as SYNAPSE', two.startsWith('MSH|^~\\&|SYNAPSE|||'))
  eq('two tests = two ORC/TQ1/OBR groups', (two.match(/\rORC\|NW/g) || []).length, 2)
  eq('  routine priority by default', (two.match(/R\^Routine\^HL70485/g) || []).length, 2)
  ok('  distinct AWOS ids', /OBR\|\|S1-249-\d{14}\|\|249\^TSH\^99ABT/.test(two) && /OBR\|\|S1-29-\d{14}\|\|29\^B-hCG\^99ABT/.test(two))
  ok('AWOS id <= 50 chars', alinityAwosId('12345678901234567890', '1218').length <= 50)
  const withPatient = buildAlinityOrderDownload({ sid: 'S2', tests: [{ assayNo: '1218' }], patient: { id: '100', name: 'Doe|John^Lee' } })
  ok('patient name sanitised into PID-5', withPatient.includes('\rPID|||100||Doe John Lee\r'))

  const neg = buildAlinityOrderDownload({
    sid: '02231522041700',
    tests: [],
    peer: { sendingApp: 'ReceiveApp1', sendingFacility: 'ReceiveFac1', receivingApp: 'SendApp1', receivingFacility: 'SendFac1' },
    stamp: '20160725022110'
  })
  eq('negative query response matches the manual', norm(neg), norm(NEGATIVE_QUERY.join(CR)))

  const acc = parseAlinityOrderResponse(decode(ORL_ACCEPTED))
  eq('ORL accepted: AA', acc?.ack, 'AA')
  eq('  echoes the OML control id', acc?.controlId, '7e68205e-a431-464c-afd7-0115b5baf653')
  eq('  ORDER#1005 OK/SC', JSON.stringify(acc?.orders), JSON.stringify([{ control: 'OK', awosId: 'ORDER#1005', status: 'SC' }]))
  const rej = parseAlinityOrderResponse(decode(ORL_REJECTED))
  eq('ORL rejected test: UA/CA', `${rej?.orders[0]?.control}/${rej?.orders[0]?.status}`, 'UA/CA')
  ok('an OML is not an ORL', parseAlinityOrderResponse(decode(ORDER_ACCEPTED)) === null)
  const nak = parseAlinityOrderResponse(
    decode([ORL_ACCEPTED[0], 'MSA|AR|7e68205e', 'ERR||SPM^1^4|101^Required field missing^HL70357|E||||Specimen type missing'])
  )
  eq('ORL AR carries the error text', nak?.error, '101 Required field missing HL70357 — Specimen type missing')
}

// =============================================================================
console.log('\n[7] Sample status, connection test and assay availability')
{
  const ssu = decode(SSU)
  ok('SSU^U03 ACKed', alinityNeedsAck(ssu))
  eq('  ACK^U03', norm(buildAlinityAck(ssu)).split('\n')[0].split('|')[8], 'ACK^U03^ACK')
  eq('  no results from a status message', parseAlinityHl7(ssu, 'ali').length, 0)

  const nmd = decode(NMD)
  ok('NMD^N02 ACKed', alinityNeedsAck(nmd))
  eq('  ACK^N02 matches the manual', norm(buildAlinityAck(nmd)), norm(NMD_ACK.join(CR)))

  const tcu = decode(TCU)
  ok('TCU^U10 ACKed', alinityNeedsAck(tcu))
  const list = extractAlinityAssays(tcu)
  eq('six installed assays learned', list.length, 6)
  eq('  658 = B-hCG available', `${list[0]?.assayNo}:${list[0]?.name}:${list[0]?.availability}`, '658:B-hCG:A')
  eq('  488 = Estradiol unavailable', `${list[1]?.assayNo}:${list[1]?.name}:${list[1]?.availability}`, '488:Estradiol:U')
  eq('  248 = TSH', list.find((a) => a.name === 'TSH')?.assayNo, '248')
  eq('  MSH-7 with a time zone still decodes', alinityControlId(tcu), '1d675aca-c827-4ce7-b843-a52de7b995dc')
}

// =============================================================================
console.log('\n[8] Simulator frame round-trips through the parser')
{
  const d = getDriver('abbott-alinity-ci')!
  const raw = buildAlinityHl7Sample('SIM001', d.info.name, d.analytes().slice(0, 3))
  const msgs = new Hl7Protocol().feedText(raw)
  const res = d.parse(msgs[0], 'ali')
  eq('three simulated analytes decode', res.length, 3)
  eq('  under the simulated barcode', res[0]?.sampleId, 'SIM001')
  eq('  assay numbers learnable', extractAlinityAssays(msgs[0]).length, 3)
}

// =============================================================================
console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
