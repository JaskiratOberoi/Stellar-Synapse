/**
 * Verify the graded name matcher: correct name matches must clear the write trust
 * floor, and every real-world mis-map that corrupted Noble must stay below it.
 * Run: npm run verify:mapgrade
 */
import { MIN_TRUSTED_CONFIDENCE } from '../src/main/core/mapping/MappingEngine'
import {
  __fuzzyNameConfidenceForTest as grade,
  __matchTestByCodeAbbreviationForTest as abbr
} from '../src/main/core/mapping/MappingEngine'

interface Case {
  instrument: string
  lis: string
  /** true = must be trusted enough to write */
  writable: boolean
  note: string
}

const CASES: Case[] = [
  // --- must WRITE: real mappings live sites depend on -------------------------
  { instrument: 'Ferritin', lis: 'Ferritin', writable: true, note: 'exact name' },
  { instrument: 'D-Dimer', lis: 'D-Dimer', writable: true, note: 'exact, punctuation' },
  { instrument: 'Cardiac Troponin I', lis: 'Troponin I', writable: true, note: 'drops qualifier' },
  {
    instrument: 'Mean Platelet Volume',
    lis: 'MEAN PLATELET VOLUME, MPV',
    writable: true,
    note: 'adds mnemonic'
  },

  // --- must NOT write: the mis-maps that corrupted Karnal SID 9268936 ---------
  {
    instrument: 'Albumin',
    lis: 'A/G (Albumin/Globulin) Ratio',
    writable: false,
    note: 'derived ratio row'
  },
  {
    instrument: 'Total Cholesterol',
    lis: 'Total Cholesterol / HdL',
    writable: false,
    note: 'derived ratio row'
  },
  { instrument: 'pH', lis: 'AFP (Alpha Fetoprotein)', writable: false, note: 'mid-word substring' },
  { instrument: 'IgE', lis: 'Globulin', writable: false, note: 'immunoGLOBULIN substring' },
  {
    instrument: 'Cholesterol',
    lis: 'LDL/ HDL CHOLESTEROL RATIO',
    writable: false,
    note: 'derived ratio row'
  },
  {
    instrument: 'Total Protein',
    lis: 'Total Protein Index',
    writable: false,
    note: 'derived index row'
  }
]

let failed = 0
for (const c of CASES) {
  const score = grade(c.instrument, c.lis)
  const writable = score >= MIN_TRUSTED_CONFIDENCE
  const ok = writable === c.writable
  if (!ok) failed++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  "${c.instrument}" -> "${c.lis}"  score=${score.toFixed(2)} ` +
      `writable=${writable} expected=${c.writable}  (${c.note})`
  )
}

// --- abbreviation matcher: a code must not lead-match a longer compound token --
// Lucknow CX4 (v0.6.13): the unit's "Ca" had no preset row and the abbreviation
// pass resolved it to "CA 72.4" (IMCA) — the shortest of the CA-family tumour
// markers — instead of leaving it for the preset. "CK" would land on "CK-MB".
console.log('')
const catalog = [
  ['BI058', 'CA 125 (Cancer Antigen)'],
  ['BI059', 'CA 15.3 (Cancer Antigen)'],
  ['BI060', 'CA 19.9 (Cancer Antigen)'],
  ['IMCA', 'CA 72.4'],
  ['BI064', 'Calcium'],
  ['BI259', 'CK-MB'],
  ['CKMBFIA', 'CK-MB, FIA'],
  ['BI088', 'Creatine kinase CK (CPK)'],
  ['BI214', ' T3 (Tri Iodothyronine ) '],
  ['BI215', ' T4 (Thyroxine ) '],
  ['BI230', 'Free T3 (FT3)'],
  ['FL02', 'CD 19'],
  ['BI0031', 'ST 2, SOLUBLE'],
  ['HBA1C', 'HbA1c - Glycated Haemoglobin'],
  ['PL1201', 'PL 12']
].map(([testCode, testName], i) => ({ id: i + 1, testCode, testName, hasParameters: false }))
const ABBR: Array<[code: string, expect: string | null, note: string]> = [
  ['Ca', null, 'must not become CA 72.4 / CA 125 (compound token after the boundary)'],
  ['CK', null, 'CK-MB rejected; Noble names the enzyme "Creatine kinase CK (CPK)", so the preset must map it'],
  ['T3', 'BI214', 'leading token + paren still matches'],
  ['T4', 'BI215', 'leading token + paren still matches'],
  ['FT3', 'BI230', 'parenthesised mnemonic still matches'],
  ['CD', null, 'CD 19 is not a "CD" test'],
  ['ST', null, 'ST 2 is not an "ST" test'],
  ['PL', null, 'PL 12 is not a "PL" test'],
  ['HBA1C', 'HBA1C', 'hyphen qualifier after a space is still a boundary']
]
for (const [code, expect, note] of ABBR) {
  const hit = abbr(code, catalog)
  const got = hit?.testCode ?? null
  const ok = got === expect
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  abbr "${code}" -> ${JSON.stringify(got)} expected ${JSON.stringify(expect)}  (${note})`)
}

console.log('')
if (failed > 0) {
  console.log(`${failed} FAILURE(S)`)
  process.exit(1)
}
console.log('ALL PASS')
