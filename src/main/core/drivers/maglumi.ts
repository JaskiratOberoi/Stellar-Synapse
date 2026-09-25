/**
 * SNIBE MAGLUMI X-series host-interface helpers.
 *
 * The X3 / X6 match host-query orders (and label uploaded results) by the assay's
 * **LIS Channel No.** as configured on the analyzer — NOT a generic LIS code.
 * Those channel names carry reagent-generation suffixes (II / III) and are
 * therefore site-specific, so they are only DEFAULTS here: each mapping's
 * analyzer channel is editable in the UI and overrides this table.
 *
 * Keyed by our driver analyte code (panels.ts) -> the analyzer's Channel No.
 */

/** X3 Channel No. verified on a live MAGLUMI X3 (Genomic Labs, 2026-06). */
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

/**
 * X6 LIS Channel No. captured from the Srinagar MAGLUMI X6 (unit X6-01, software
 * V1) Parameter Definition > Assay Parameters screens on 2026-09-25, cross-checked
 * against the eLab Assist wire capture of 21-24 Sep 2026 (logINMessage): every
 * channel marked "log" in presets/srinagar.json was seen in an O/R record.
 *
 * The X6 keeps superseded reagent generations in its menu (TSH, T3, TEST, E2,
 * ANA, CCP, FT3, FT4, Vit B12 II) beside the current ones; it resolves an ORDERED
 * channel to whichever generation is on board and labels the UPLOAD with that
 * generation's channel (eLab ordered "CEA" and got "CEA II" back, "tPSA II" and
 * got "PSA"). Results are therefore matched by instrumentCode OR this channel.
 */
export const MAGLUMI_X6_CHANNELS: Record<string, string> = {
  // Thyroid
  TSH: 'TSH II',
  T3: 'TT3 II',
  T4: 'TT4 II',
  FT3: 'FT3 II',
  FT4: 'FT4 II',
  ATPO: 'Anti-TPO II',
  // Fertility / endocrine
  FSH: 'FSH II',
  LH: 'LH II',
  PRL: 'PRL II',
  E2: 'E2 II',
  PROG: 'PROG II',
  TESTO: 'TEST II',
  BHCG: 'T-B HCG II',
  AMH: 'AMH II',
  CORT: 'Cortisol II',
  INS: 'INS II',
  PTH: 'PTH II',
  // Tumour markers
  CEA: 'CEA II',
  AFP: 'AFP II',
  CA125: 'CA125 II',
  CA199: 'CA19-9 II',
  PSA: 'tPSA II',
  // Vitamins / anaemia
  VITD: '25-OH VD II',
  VITB12: 'Vit B12 III',
  FOLATE: 'FA II',
  FERR: 'Ferritin II',
  // Cardiac / inflammation / allergy / autoimmune
  NTBNP: 'NT-proBNP II',
  PCT: 'PCT II',
  IGE: 'IgE II',
  ACCP: 'CCP II',
  ANA: 'ANA II',
  TTGA: 'tTG IgA',
  // Infectious disease (qualitative CLIA, AU/mL cut-off index)
  HBSAG: 'HBsAg Quant',
  HCV: 'Anti-HCV II',
  HIV: 'HIV Combi',
  HAVM: 'HAV IgM',
  TOXO: 'TOXO IgG',
  TOXOM: 'TOXO IgM',
  RUBELLA: 'Rubella IgG',
  RUBM: 'Rubella IgM',
  CMV: 'CMV IgG',
  CMVM: 'CMV IgM',
  HSV12G: 'HSV-1/2 IgG II',
  HSV12M: 'HSV-1/2 IgM'
}

/**
 * Drivers whose host query / result labelling runs on a Channel No. table. The
 * Orchestrator restricts each of these to exactly its table's analytes (nothing
 * else can be ordered or written) and the mapping engine seeds the channel as
 * the default analyzerCode.
 */
export const MAGLUMI_CHANNELS_BY_DRIVER: Record<string, Record<string, string>> = {
  'maglumi-x3': MAGLUMI_X3_CHANNELS,
  'maglumi-x6': MAGLUMI_X6_CHANNELS
}

/** Default Channel No. for an analyte code on a channel-addressed driver, if known. */
export function maglumiChannel(driverId: string, code: string): string | undefined {
  return MAGLUMI_CHANNELS_BY_DRIVER[driverId]?.[code.trim().toUpperCase()]
}

/** Default X3 Channel No. for an analyte code, if known. */
export function maglumiX3Channel(code: string): string | undefined {
  return MAGLUMI_X3_CHANNELS[code.trim().toUpperCase()]
}
