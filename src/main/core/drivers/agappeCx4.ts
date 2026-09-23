import { randomUUID } from 'node:crypto'
import type { CanonicalResult, ResultFlag } from '../../../shared/types'
import type { ProtocolMessage } from '../protocols/IProtocol'
import type { DriverAnalyte } from './IInstrumentDriver'
import { simValue } from './sampleBuilders'

/**
 * Agappe Mispa CX4 clinical-chemistry ASTM dialect (Dirui CS-400 platform).
 *
 * Source: Mispa CX4 user manual REV.09-2017, §5.9 "Host communication setup"
 * and Appendix E "LIS Communication Setup Instructions (Version No. 1.1)".
 * The analyzer speaks ASTM E1381 framing + E1394 records over RS-232 only
 * (COM 1-4 on the analyzer PC; default 19200 8-N-1, selectable 4800/9600/19200,
 * 7/8 data bits, parity N/E/O, 1/2 stop bits). Reach it over LAN via a
 * serial-to-Ethernet device server if needed.
 *
 * Every record travels in its OWN E1381 frame — frame numbers 1..7 then 0,
 * a <CR> before <ETX>, and a modulo-256 checksum over FN..<CR><ETX> — inside a
 * single ENQ/ACK/EOT session. Verified against the manual's printed checksums
 * (`1H|\^&<CR><ETX>` -> E5, `2P|1|||||||||||||^<CR><ETX>` -> E9, `6L|1|N` -> 09).
 *
 * Cross-checked against the generic Dirui "Network Communication Interface
 * Protocol" (Appendix E v1.1, the same text with the analyzer unbranded): the
 * H-record sender (field 5) and receiver (field 10) are the "Analyzer ID" and
 * "Host ID" typed on the Host Communication screen — NOT fixed strings — so
 * auto-discovery only recognises the unit when its Analyzer ID contains "CX4".
 *
 * 1. RESULT UPLOAD (analyzer -> host), real-time per sample or batch:
 *      H|\^&|||<Analyzer ID>|||||<Host ID>||1|<ts>
 *      P|1|||||||||||||^                       (name / sex / age^Y when known)
 *      O|1|<SID>^<S.No>^<Disk>^<Pos>^<Dil>|||R|<ts>|||||||||1||||||||||O
 *      R|1|^^^ALT|-2|U/L|3^12\0^20|N||F||||<ts>
 *      L|1|N
 *    The barcode is component 1 of the O Specimen ID (field 3); in "Sample No."
 *    mode component 1 is EMPTY and component 2 carries the analyzer's running
 *    sample number instead (no barcode reader). R field 3 is the standard
 *    universal test id `^^^<item abbreviation>`; field 4 the value, 5 the unit,
 *    6 `low^high` normal range then `\` critical range, 7 the flag (L/H/N/A),
 *    9 the status (F final / C corrected), 13 the completion timestamp.
 *
 * 2. HOST QUERY (analyzer -> host), bidirectional mode, sent when a barcode is
 *    scanned with no local test selection (one Q per sample, or a batch of Qs
 *    after "S. Barcode Scan"):
 *      H|\^&|||CX4|||||Host||1|<ts>
 *      Q|1|<SID>^<S.No>^<Disk>^<Pos>^<Dil>||ALL||||||||O
 *      L|1|N
 *
 * 3. ORDER DOWNLOAD (host -> analyzer) — Synapse's reply, ONE O record PER
 *    TEST, echoing the query's full Specimen ID so the order lands on the
 *    scanned disk/position:
 *      H|\^&
 *      P|1|||||||||||||^
 *      O|1|<specimen>||^^^AST|R|<ts>|||||||||1||||||||||O
 *      O|2|<specimen>||^^^TP|R|<ts>|||||||||1||||||||||O
 *      L|1|N
 *    Field 16 = specimen descriptor (1 serum in both manual editions; the
 *    Agappe edition lists 2 urine, 3 CSF, 4 supernatant, 5 other, the Dirui
 *    edition 2 urine, 3 plasma, 4 gastric juice, 5 ascites, 6 CSF, 7 other),
 *    field 26 = report type "O". When the LIS has no order for the sample the
 *    manual requires the host to answer with a bare <ENQ> … <EOT> (no records
 *    at all) so the analyzer stops waiting.
 *
 * 4. QC UPLOAD ("Send QC Result To LIS"): P|1||||QC…, O with the control
 *    name^lot in field 4 and no barcode, R flags as Westgard rules — skipped by
 *    the parser (see isQcOrder).
 */

// ---------------------------------------------------------------------------
// Analyte panel — the item abbreviations from Appendix C ("Biochemical Reagent
// Parameters frequently used by AGAPPE"), i.e. what the analyzer transmits as
// the R-record universal test id when the lab keeps the factory item names.
// Units/ranges are simulator defaults only; the live unit rides in R field 5.
// ---------------------------------------------------------------------------
const a = (
  code: string,
  name: string,
  unit: string,
  min: number,
  max: number,
  decimals = 2,
  ref?: string
): DriverAnalyte => ({
  code,
  name,
  unit,
  sim: { min, max, decimals, ref: ref ?? `${min} to ${max}` }
})

export const AGAPPE_CX4_CHEM: DriverAnalyte[] = [
  // Liver
  a('ALT', 'Alanine Aminotransferase', 'U/L', 7, 56, 0),
  a('AST', 'Aspartate Aminotransferase', 'U/L', 5, 40, 0),
  a('ALP', 'Alkaline Phosphatase', 'U/L', 44, 147, 0),
  a('GGT', 'Gamma GT', 'U/L', 8, 61, 0),
  a('TB', 'Total Bilirubin', 'mg/dL', 0.3, 1.2),
  a('DB', 'Direct Bilirubin', 'mg/dL', 0, 0.3),
  a('TB-V', 'Total Bilirubin (Vanadate)', 'mg/dL', 0.3, 1.2),
  a('DB-V', 'Direct Bilirubin (Vanadate)', 'mg/dL', 0, 0.3),
  a('TBA', 'Total Bile Acids', 'umol/L', 0, 10, 1),
  a('TP', 'Total Protein', 'g/dL', 6.4, 8.3, 1),
  a('ALB', 'Albumin', 'g/dL', 3.5, 5.2, 1),
  a('LAP', 'Leucine Aminopeptidase', 'U/L', 20, 50, 0),
  a('CHE', 'Cholinesterase', 'U/L', 5000, 12000, 0),
  a('GLDH', 'Glutamate Dehydrogenase', 'U/L', 0, 7, 1),
  a('ICDH', 'Isocitrate Dehydrogenase', 'U/L', 0, 7, 1),
  a('ADA', 'Adenosine Deaminase', 'U/L', 0, 30, 1),
  a('5-NT', "5'-Nucleotidase", 'U/L', 0, 10, 1),
  // Glucose / renal
  a('GLU(HK)', 'Glucose (Hexokinase)', 'mg/dL', 70, 100, 0),
  a('GLU(OX)', 'Glucose (Oxidase)', 'mg/dL', 70, 100, 0),
  a('HbA1C', 'HbA1c', '%', 4, 5.6, 1),
  a('HbA1c-S', 'HbA1c (S)', '%', 4, 5.6, 1),
  a('FMN', 'Fructosamine', 'umol/L', 205, 285, 0),
  a('UREA', 'Urea', 'mg/dL', 15, 40, 0),
  a('BUN', 'Blood Urea Nitrogen', 'mg/dL', 7, 20, 0),
  a('UA', 'Uric Acid', 'mg/dL', 3.5, 7.2, 1),
  a('CRE', 'Creatinine (Jaffe)', 'mg/dL', 0.7, 1.3),
  a('CRE-E', 'Creatinine (Enzymatic)', 'mg/dL', 0.7, 1.3),
  a('CYS-C', 'Cystatin C', 'mg/L', 0.5, 1.0),
  a('MALB', 'Microalbumin', 'mg/L', 0, 20, 1),
  a('TPU', 'Total Protein (Urine)', 'mg/dL', 0, 15, 1),
  a('NAG', 'N-Acetyl-Glucosaminidase', 'U/L', 0, 12, 1),
  a('B2-MG', 'Beta-2 Microglobulin', 'mg/L', 0.8, 2.2),
  a('A1-MG', 'Alpha-1 Microglobulin', 'mg/L', 0, 14, 1),
  a('RBP', 'Retinol Binding Protein', 'mg/L', 25, 70, 1),
  // Lipids
  a('TC', 'Total Cholesterol', 'mg/dL', 125, 200, 0),
  a('TG', 'Triglycerides', 'mg/dL', 50, 150, 0),
  a('HDL-C', 'HDL Cholesterol', 'mg/dL', 40, 60, 0),
  a('LDL-C', 'LDL Cholesterol', 'mg/dL', 50, 130, 0),
  a('APOA1', 'Apolipoprotein A1', 'g/L', 1.0, 1.6),
  a('APO B', 'Apolipoprotein B', 'g/L', 0.6, 1.2),
  a('Lp(a)', 'Lipoprotein (a)', 'mg/dL', 0, 30, 1),
  a('HCY', 'Homocysteine', 'umol/L', 5, 15, 1),
  // Cardiac / muscle
  a('CK', 'Creatine Kinase', 'U/L', 30, 200, 0),
  a('CK-MB', 'Creatine Kinase MB', 'U/L', 0, 25, 0),
  a('LDH', 'Lactate Dehydrogenase', 'U/L', 140, 280, 0),
  a('HBDH', 'Hydroxybutyrate Dehydrogenase', 'U/L', 72, 182, 0),
  a('MYO', 'Myoglobin', 'ng/mL', 0, 70, 0),
  a('cTnI', 'Troponin I', 'ng/mL', 0, 0.04, 3),
  a('LAC', 'Lactate', 'mmol/L', 0.5, 2.2, 1),
  // Pancreas
  a('AMY', 'Amylase', 'U/L', 28, 100, 0),
  a('PAMY', 'Pancreatic Amylase', 'U/L', 13, 53, 0),
  a('LPS', 'Lipase', 'U/L', 13, 60, 0),
  // Electrolytes / minerals (colorimetric + optional ISE K/Na/Cl)
  a('K', 'Potassium', 'mmol/L', 3.5, 5.1, 1),
  a('Na', 'Sodium', 'mmol/L', 135, 145, 0),
  a('Cl', 'Chloride', 'mmol/L', 98, 107, 0),
  a('Ca(CPC)', 'Calcium (CPC)', 'mg/dL', 8.6, 10.2, 1),
  a('Ca(ARS)', 'Calcium (Arsenazo)', 'mg/dL', 8.6, 10.2, 1),
  a('Mg', 'Magnesium', 'mg/dL', 1.7, 2.4),
  a('PHOS', 'Phosphorus', 'mg/dL', 2.5, 4.5, 1),
  a('PHOS-S', 'Phosphorus (S)', 'mg/dL', 2.5, 4.5, 1),
  a('Fe', 'Iron', 'ug/dL', 60, 170, 0),
  a('UIBC', 'Unsaturated Iron Binding Capacity', 'ug/dL', 110, 370, 0),
  a('Zn', 'Zinc', 'umol/L', 10, 20, 1),
  a('CO2', 'Bicarbonate (CO2)', 'mmol/L', 22, 29, 0),
  a('CO2-C', 'Bicarbonate (CO2-C)', 'mmol/L', 22, 29, 0),
  // Immunoturbidimetric proteins
  a('CRP', 'C-Reactive Protein', 'mg/L', 0, 5, 1),
  a('HS-CRP', 'High-Sensitivity CRP', 'mg/L', 0, 3),
  a('RF', 'Rheumatoid Factor', 'IU/mL', 0, 14, 1),
  a('ASO', 'Anti-Streptolysin O', 'IU/mL', 0, 200, 0),
  a('IgA', 'Immunoglobulin A', 'g/L', 0.7, 4.0),
  a('IgG', 'Immunoglobulin G', 'g/L', 7, 16, 1),
  a('IgM', 'Immunoglobulin M', 'g/L', 0.4, 2.3),
  a('C3', 'Complement C3', 'g/L', 0.9, 1.8),
  a('C4', 'Complement C4', 'g/L', 0.1, 0.4),
  a('PA', 'Prealbumin', 'mg/L', 200, 400, 0),
  // Stock item names of the underlying Dirui software (Sample Register screen
  // in the generic "Network Communication Interface Protocol" manual, v1.1)
  // that differ from Agappe's Appendix C abbreviations above. A unit set up
  // from the stock menu transmits these instead — listed so the mapping screen
  // recognises them; the site presets map the Appendix C names and say how to
  // swap. Case variants (HbA1c) and the serum indices (L, H, I) are omitted.
  a('P', 'Phosphorus (stock name)', 'mg/dL', 2.5, 4.5, 1),
  a('TBIL', 'Total Bilirubin (stock name)', 'mg/dL', 0.3, 1.2),
  a('DBIL', 'Direct Bilirubin (stock name)', 'mg/dL', 0, 0.3),
  a('GLU', 'Glucose (stock name)', 'mg/dL', 70, 100, 0),
  a('Ca', 'Calcium (stock name)', 'mg/dL', 8.6, 10.2, 1),
  a('Mb', 'Myoglobin (stock name)', 'ng/mL', 0, 70, 0),
  a("5'-NT", "5'-Nucleotidase (stock name)", 'U/L', 0, 10, 1),
  a('APO A1', 'Apolipoprotein A1 (stock name)', 'g/L', 1.0, 1.6),
  a('U-HS-CRP', 'Ultra-Sensitive CRP', 'mg/L', 0, 1),
  a('AFU', 'Alpha-L-Fucosidase', 'U/L', 0, 40, 0),
  a('Cu', 'Copper', 'umol/L', 11, 22, 1),
  a('D-Dimer', 'D-Dimer', 'mg/L FEU', 0, 0.5),
  a('ACE', 'Angiotensin Converting Enzyme', 'U/L', 8, 52, 0),
  a('GPDA', 'Glycylproline Dipeptidyl Aminopeptidase', 'U/L', 20, 100, 0),
  a('AFP', 'Alpha Fetoprotein (turbidimetric)', 'ng/mL', 0, 20, 1),
  a('AMM', 'Ammonia', 'umol/L', 10, 47, 0),
  a('ACP', 'Acid Phosphatase', 'U/L', 0, 6, 1),
  a('MAST', 'Mannose-Binding Lectin', 'ng/mL', 0, 1000, 0),
  a('TRF', 'Transferrin', 'g/L', 2.0, 3.6),
  a('FER', 'Ferritin', 'ng/mL', 20, 300, 0)
]

// ---------------------------------------------------------------------------
// Specimen-ID helpers (shared by the parser, the query path and the order
// builder): `<Sample ID>^<Sample No>^<Disk>^<Position>^<Diluent Y/N>`.
// ---------------------------------------------------------------------------

/** Split a CX4 specimen-id field into its trimmed caret components. */
function specimenParts(field: string | undefined): string[] {
  return (field ?? '').split('^').map((p) => p.trim())
}

/**
 * The LIS barcode for a CX4 specimen-id field: component 1 (ID mode). In
 * "Sample No." mode component 1 is empty and there is no barcode to look up —
 * returns '' so the caller can answer "not registered" instead of querying the
 * LIS for the analyzer's running sample number (which could collide with a
 * real short accession number).
 */
export function cx4SampleId(specimenField: string | undefined): string {
  return specimenParts(specimenField)[0] ?? ''
}

/**
 * Sample id to file results under: the barcode when present, else a clearly
 * non-barcode label built from the analyzer's sample number so the result still
 * shows in the Received panel (as "not registered") without ever matching a
 * real LIS accession.
 */
function resultSampleId(specimenField: string | undefined): string {
  const parts = specimenParts(specimenField)
  if (parts[0]) return parts[0]
  return parts[1] ? `SNO-${parts[1]}` : ''
}

// ---------------------------------------------------------------------------
// Parsing (analyzer -> canonical results)
// ---------------------------------------------------------------------------

function normFlag(raw?: string): ResultFlag | undefined {
  if (!raw) return undefined
  const f = raw.trim().toUpperCase()
  if (['N', 'H', 'L', 'HH', 'LL', 'A'].includes(f)) return f as ResultFlag
  return undefined
}

/** Universal test id `^^^CODE` (standard) or, defensively, the first non-empty component. */
function testCode(field?: string): string {
  const parts = specimenParts(field)
  if (parts[0] === '' && parts[1] === '' && parts[2] === '') return parts[3] ?? ''
  return parts.find((p) => p.length > 0) ?? ''
}

/**
 * R field 6 is `low^high` (normal range) then `\` and `low^high` (critical
 * range). Render the normal range as "low-high"; an empty placeholder such as
 * `^\^` (the analyzer's default when no range is configured) becomes undefined.
 */
export function cx4ReferenceRange(field?: string): string | undefined {
  const normal = (field ?? '').split('\\')[0] ?? ''
  const [lo = '', hi = ''] = normal.split('^').map((p) => p.trim())
  if (!lo && !hi) return undefined
  return `${lo}-${hi}`
}

/** Parse a Mispa CX4 ASTM result message into canonical results. */
/**
 * A "Send QC Result To LIS" upload is not a patient result. The Dirui/Agappe
 * host manual (Appendix E, "Control result") shapes it as
 *   P|1||||QC|||||||^
 *   O|1|^0^1^^|<QC name>^<QC lot>^|||<ts>|||||||||1||||||||||O
 *   R|1|^^^ALT|333|U/L|2^22|1-3s|>+3SD|||||<ts>
 * i.e. the O Instrument Specimen ID (field 4) carries the control name/lot,
 * the specimen id has no barcode, and R field 7 is a Westgard rule. Detected
 * on the O record so the whole block is skipped rather than filed under a
 * bogus "SNO-0" sample.
 */
function isQcOrder(rec: string[]): boolean {
  return (rec[3] ?? '').replace(/\^/g, '').trim().length > 0
}

export function parseAgappeCx4Astm(
  message: ProtocolMessage,
  instrumentId: string
): CanonicalResult[] {
  const results: CanonicalResult[] = []
  let currentSample = ''
  let skipping = false
  const now = new Date().toISOString()

  for (const rec of message.records) {
    const type = (rec[0] || '').toUpperCase()
    if (type === 'O') {
      skipping = isQcOrder(rec)
      currentSample = skipping ? '' : resultSampleId(rec[2])
    } else if (type === 'R') {
      if (skipping) continue
      const code = testCode(rec[2])
      if (!code) continue
      results.push({
        id: randomUUID(),
        instrumentId,
        sampleId: currentSample,
        analyteCode: code,
        analyteName: code,
        value: (rec[3] || '').trim(),
        unit: (rec[4] || '').trim() || undefined,
        referenceRange: cx4ReferenceRange(rec[5]),
        flag: normFlag(rec[6]),
        // Date/Time Test Completed is field 13 (index 12).
        measuredAt: rec[12]?.trim() ? rec[12].trim() : undefined,
        receivedAt: now
      })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Order download (host -> analyzer) — answer a host query
// ---------------------------------------------------------------------------

const STX = 0x02
const ETX = 0x03

function ts(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`
}

/**
 * Frame one record as the CX4 expects: STX FN text CR ETX C1C2 CR LF, the
 * checksum being the modulo-256 sum of FN..CR..ETX as two upper-case hex
 * digits. Matches the manual's worked frames (`1H|\^&` -> E5, `6L|1|N` -> 09).
 */
export function frameAgappeCx4Record(frameNum: number, record: string): Buffer {
  const body = `${frameNum % 8}${record}\r${String.fromCharCode(ETX)}`
  let sum = 0
  for (let i = 0; i < body.length; i++) sum = (sum + body.charCodeAt(i)) & 0xff
  const cs = sum.toString(16).toUpperCase().padStart(2, '0')
  return Buffer.from(String.fromCharCode(STX) + body + cs + '\r\n', 'latin1')
}

/**
 * Build the logical order records answering a CX4 host query. `specimen` is the
 * Specimen ID field exactly as the analyzer sent it in its Q record
 * (`SID^S.No^Disk^Pos^Dil`), echoed back so the order attaches to the scanned
 * position; `codes` are the analyzer's item abbreviations. One O record per
 * test (the CX4 does not read the ASTM repeat delimiter). `now` is injectable
 * so the verify script can reproduce the manual's printed frames byte-for-byte.
 */
export function buildAgappeCx4OrderRecords(
  specimen: string,
  codes: readonly string[],
  now = ts()
): string[] {
  const records: string[] = ['H|\\^&', 'P|1|||||||||||||^']
  codes.forEach((code, i) => {
    // O-3 specimen echo, O-5 universal test id, O-6 priority R, O-7 order
    // time, O-16 specimen descriptor 1 (serum), O-26 report type O.
    records.push(`O|${i + 1}|${specimen}||^^^${code}|R|${now}|||||||||1||||||||||O`)
  })
  records.push('L|1|N')
  return records
}

/**
 * Frame the order as the ENQ/ACK-gated units the sender transmits: one E1381
 * frame per record, frame numbers 1..7 then 0. The AstmHostQuerySender adds the
 * leading ENQ, waits for each ACK, and sends the trailing EOT.
 */
export function buildAgappeCx4OrderFrames(
  specimen: string,
  codes: readonly string[],
  now?: string
): Buffer[] {
  return buildAgappeCx4OrderRecords(specimen, codes, now).map((rec, i) =>
    frameAgappeCx4Record(i + 1, rec)
  )
}

// ---------------------------------------------------------------------------
// Simulator (build a realistic result upload) — exercises parseAgappeCx4Astm
// ---------------------------------------------------------------------------

/** Build a Mispa CX4 ASTM result message body (CR-separated records) for a sample. */
export function buildAgappeCx4AstmSample(sampleId: string, analytes: DriverAnalyte[]): string {
  const now = ts()
  const lines: string[] = []
  lines.push(`H|\\^&|||CX4|||||Host||1|${now}`)
  lines.push(`P|1|||||||||||||^`)
  lines.push(`O|1|${sampleId}^1^1^1^N|||R|${now}|||||||||1||||||||||O`)
  analytes.forEach((an, i) => {
    const { value, flag } = simValue(an)
    const range = an.sim ? `${an.sim.min}^${an.sim.max}\\^` : '^\\^'
    lines.push(`R|${i + 1}|^^^${an.code}|${value}|${an.unit ?? ''}|${range}|${flag}||F||||${now}`)
  })
  lines.push(`L|1|N`)
  return lines.join('\r')
}
