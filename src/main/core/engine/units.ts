import type { CanonicalResult, MappingRule } from '../../../shared/types'

/**
 * Unit reconciliation between what an analyzer transmits and what the LIS field
 * actually holds.
 *
 * Every rule here is guarded on BOTH the source unit and the mapping's target
 * unit. That is deliberate: if an analyzer is later reconfigured to send the
 * LIS's unit directly, the source no longer matches and the rule simply stops
 * firing — it can never double-convert. Adding a rule keyed only on the analyte
 * would lose that property.
 *
 * Anything not listed here passes through untouched, so a conversion is only
 * ever applied where it has been explicitly verified against real LIS rows.
 */

/** Normalize a unit for comparison: strip spaces, lowercase ("µIU/mL" -> "µiu/ml"). */
function norm(unit: string | undefined): string {
  return (unit ?? '').replace(/\s+/g, '').toLowerCase()
}

/**
 * Identifies free T3 across the ways a driver may label it — the Getein MAGICL
 * keys analytes by a bare numeric item-id (FT3 = "21"), so the analyte code
 * alone is not self-describing and the mapping's names are checked too.
 * `\bFT3\b` and "free t3" both exclude FT4 and total T3.
 */
const FT3_PATTERN = /\bFT3\b|free\s*t3/i

/**
 * pmol/L -> pg/mL is molar-mass dependent, so it can NEVER be applied
 * generically: the factor is molar mass / 1000. Free T3 is 650.98 g/mol ->
 * 0.651. A different pmol/L analyte reaching this path is left unconverted
 * rather than silently scaled by the wrong constant.
 */
const FT3_PMOL_L_TO_PG_ML = 0.651

/**
 * Convert an analyzer result into the unit the mapped LIS field holds.
 * Returns the value verbatim when no verified conversion applies.
 */
export function convertForLis(
  result: CanonicalResult,
  rule: MappingRule
): { value: string; unit?: string } {
  if (result.analyteCode === 'eAG' && result.unit === 'mmol/L') {
    const n = parseFloat(result.value)
    if (!isNaN(n)) {
      // Noble's eAG parameter is always mg/dL; convert the analyzer's mmol/L
      // value and always label it mg/dL (never the analyzer's source unit).
      return { value: (n * 18.0182).toFixed(1), unit: 'mg/dL' }
    }
  }

  const srcUnit = norm(result.unit)
  const tgtUnit = norm(rule.unit)

  // Hematology analyzers (e.g. EDAN H60) report HGB/MCHC in g/L while Noble's
  // CBC fields are g/dL — convert by /10 whenever the analyzer reports g/L and
  // the mapping's target unit is g/dL (so 144 g/L -> 14.4 g/dL).
  if (srcUnit === 'g/l' && tgtUnit === 'g/dl') {
    const n = parseFloat(result.value)
    if (!Number.isNaN(n)) return { value: (n / 10).toFixed(1), unit: 'g/dL' }
  }

  // Free T3: the Getein MAGICL transmits pmol/L (its LIS Unit is left at the
  // analyzer's own unit, unlike T3/T4/FT4/Testosterone which it converts on the
  // way out) while Noble's FT3 field holds pg/mL — verified 400/400 rows. The
  // 1.54x gap reads a normal FT3 as elevated, so it must be converted here.
  if (srcUnit === 'pmol/l' && tgtUnit === 'pg/ml' && isFreeT3(result, rule)) {
    const n = parseFloat(result.value)
    if (!Number.isNaN(n)) {
      return { value: (n * FT3_PMOL_L_TO_PG_ML).toFixed(2), unit: 'pg/mL' }
    }
  }

  // ng/dL -> ng/L is purely dimensional (x10) and independent of the analyte,
  // so unlike the pmol/L case it needs no per-analyte guard. The MAGICL sends
  // free T4 in ng/dL where Noble's field is ng/L (verified 300/300 rows,
  // 10.18-14.70); writing ng/dL raw would read 10x low.
  if (srcUnit === 'ng/dl' && tgtUnit === 'ng/l') {
    const n = parseFloat(result.value)
    if (!Number.isNaN(n)) return { value: (n * 10).toFixed(2), unit: 'ng/L' }
  }

  return { value: result.value, unit: result.unit ?? rule.unit }
}

/** True when this result/mapping pair is free T3 (see FT3_PATTERN). */
function isFreeT3(result: CanonicalResult, rule: MappingRule): boolean {
  return [result.analyteCode, result.analyteName, rule.instrumentName, rule.lisTestName].some(
    (s) => !!s && FT3_PATTERN.test(s)
  )
}
