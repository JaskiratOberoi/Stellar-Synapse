/**
 * SNIBE MAGLUMI X3 host-interface helpers.
 *
 * The X3 matches host-query orders (and labels uploaded results) by the assay's
 * **Channel No.** as configured on the analyzer — NOT a generic LIS code. Those
 * channel names carry reagent-generation suffixes (II / III) and are therefore
 * site-specific, so they are only DEFAULTS here: each mapping's analyzer channel
 * is editable in the UI and overrides this table.
 *
 * Keyed by our driver analyte code (panels.ts) -> the X3 Channel No. verified on
 * a live MAGLUMI X3 (Genomic Labs, 2026-06).
 */
export const MAGLUMI_X3_CHANNELS: Record<string, string> = {
  TSH: 'TSH II',
  T3: 'TT3 II',
  T4: 'TT4 II',
  FT3: 'FT3 II',
  FT4: 'FT4 II',
  FSH: 'FSH II',
  LH: 'LH II',
  PRL: 'PRL II',
  E2: 'E2 II',
  TESTO: 'TEST II',
  BHCG: 'T-B HCG II',
  AMH: 'AMH II',
  CA125: 'CA125 II',
  PSA: 'PSA',
  VITD: '25-OH VD II',
  VITB12: 'Vit B12 III',
  ACCP: 'CCP II',
  // Specialty endocrine / allergy channels (verified on the Delhi MAGLUMI X3, 2026-07).
  CORT: 'Cortisol II',
  '17OHP': '17a-OH P',
  GH: 'GH II',
  IGE: 'IgE II'
}

/** Default X3 Channel No. for an analyte code, if known. */
export function maglumiX3Channel(code: string): string | undefined {
  return MAGLUMI_X3_CHANNELS[code.trim().toUpperCase()]
}
