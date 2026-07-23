/**
 * Verify the graded name matcher: correct name matches must clear the write trust
 * floor, and every real-world mis-map that corrupted Noble must stay below it.
 * Run: npm run verify:mapgrade
 */
import { MIN_TRUSTED_CONFIDENCE } from '../src/main/core/mapping/MappingEngine'
import { __fuzzyNameConfidenceForTest as grade } from '../src/main/core/mapping/MappingEngine'

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

console.log('')
if (failed > 0) {
  console.log(`${failed} FAILURE(S)`)
  process.exit(1)
}
console.log('ALL PASS')
