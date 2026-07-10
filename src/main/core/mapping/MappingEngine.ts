import { randomUUID } from 'node:crypto'
import type { CanonicalResult, LisParameter, LisTest, MappingRule } from '../../../shared/types'
import type { ILisRepository } from '../lis/ILisRepository'
import { getDriver } from '../drivers/registry'
import { maglumiX3Channel } from '../drivers/maglumi'
import { auVariantGroup } from '../drivers/beckmanAu'
import { persist } from '../../store'
import { logger } from '../logger'

interface MappingTarget {
  lisTestId?: number
  lisTestCode?: string
  lisTestName?: string
  lisParamId?: number
  lisParamName?: string
  unit?: string
  confidence: number
}

/**
 * Resolves instrument analyte codes to LIS test/parameter targets. Supports
 * auto-suggestion (by exact/fuzzy code and name match against the LIS catalog)
 * and manual overrides, persisted via electron-store.
 */
export class MappingEngine {
  private rules: MappingRule[] = []

  constructor(private readonly lis: ILisRepository) {
    this.rules = persist.getMappings()
  }

  /**
   * Ensure every analyte of the given drivers has a mapping row, auto-suggesting
   * targets. Seeding is scoped to drivers that are actually in use (configured
   * instruments) so the large model catalog doesn't bloat the mapping store.
   * Returns the number of rows added.
   */
  async seedDrivers(driverIds: string[]): Promise<number> {
    // The LIS may be unreachable at startup — never let that abort boot. Seed
    // rule rows anyway (as 'unmapped'); they auto-map once the LIS is back and a
    // result arrives (autoMapOnReceive), or on the next manual auto-map.
    let tests: LisTest[] = []
    let params: LisParameter[] = []
    try {
      tests = await this.lis.getTests()
      params = await this.lis.getParameters()
    } catch (err) {
      logger.warn(
        'mapping',
        `LIS catalog unavailable — seeding analytes unmapped, will auto-map later: ${(err as Error).message}`
      )
    }
    let added = 0

    const unique = [...new Set(driverIds)]
    let backfilled = 0
    for (const driverId of unique) {
      const driver = getDriver(driverId)
      if (!driver) continue
      for (const analyte of driver.analytes()) {
        // Default analyzer channel name (e.g. MAGLUMI X3 "Channel No.").
        const channel = driverId === 'maglumi-x3' ? maglumiX3Channel(analyte.code) : undefined
        const exists = this.rules.find(
          (r) => r.driverId === driverId && r.instrumentCode === analyte.code
        )
        if (exists) {
          // Backfill the channel name onto rules created before this field existed
          // (e.g. an in-place upgrade), without touching an operator's override.
          if (channel && !exists.analyzerCode) {
            exists.analyzerCode = channel
            backfilled++
          }
          continue
        }
        const target = this.suggest(analyte.code, analyte.name, tests, params)
        this.rules.push({
          id: randomUUID(),
          driverId,
          instrumentCode: analyte.code,
          instrumentName: analyte.name,
          analyzerCode: channel,
          unit: analyte.unit,
          status: target ? 'auto' : 'unmapped',
          confidence: target?.confidence,
          lisTestId: target?.lisTestId,
          lisTestCode: target?.lisTestCode,
          lisTestName: target?.lisTestName,
          lisParamId: target?.lisParamId,
          lisParamName: target?.lisParamName,
          updatedAt: new Date().toISOString()
        })
        added++
      }
    }

    if (added > 0 || backfilled > 0) {
      this.save()
      logger.info(
        'mapping',
        `Seeded ${added} mapping row(s) (+${backfilled} channel backfill) for ${unique.length} in-use driver(s)`
      )
    }
    return added
  }

  /** Suggest a LIS target for an instrument analyte (code first, then name). */
  private suggest(
    code: string,
    name: string | undefined,
    tests: LisTest[],
    params: LisParameter[]
  ): MappingTarget | null {
    const c = code.trim().toUpperCase()

    // 0) Hematology CBC analyte (WBC, NEU%, HGB, …): the H60 mnemonics don't
    // equal Noble's parameter codes, and the same cell name often exists in
    // several panels (e.g. a "Neutrophils" param under a body-fluid test), so
    // match by curated synonyms and prefer the CBC panel.
    const cbc = suggestCbcParam(c, tests, params)
    if (cbc) return cbc

    // 1) Exact parameter code match (panel members like WBC, NA).
    const paramExact = params.find((p) => p.code.toUpperCase() === c)
    if (paramExact) {
      const parent = tests.find((t) => t.id === paramExact.testId)
      return {
        lisTestId: parent?.id,
        lisTestCode: parent?.testCode,
        lisTestName: parent?.testName,
        lisParamId: paramExact.id,
        lisParamName: paramExact.name,
        unit: paramExact.unit,
        confidence: 1
      }
    }

    // 1b) LD-560 HbA1c panel — match parameters by name (HbA1c %, eAG mg/dL).
    const paramByAnalyte = params.find((p) => paramMatchesAnalyte(p, code, name))
    if (paramByAnalyte) {
      const parent = tests.find((t) => t.id === paramByAnalyte.testId)
      return {
        lisTestId: parent?.id,
        lisTestCode: parent?.testCode,
        lisTestName: parent?.testName,
        lisParamId: paramByAnalyte.id,
        lisParamName: paramByAnalyte.name,
        unit: lisUnitForAnalyte(code, paramByAnalyte.unit),
        confidence: 0.95
      }
    }

    // 2) Exact test code match (standalone tests like TSH).
    const testExact = tests.find((t) => t.testCode.toUpperCase() === c)
    if (testExact) {
      return {
        lisTestId: testExact.id,
        lisTestCode: testExact.testCode,
        lisTestName: testExact.testName,
        confidence: 1
      }
    }

    // 2b) Abbreviation match: many LIS tests carry the analyzer's mnemonic in the
    // name itself — either parenthesized ("Free T3 (FT3)", "Anti - Mullerian
    // Hormone (AMH)") or as a leading token ("T3 (Tri Iodothyronine)", "T4
    // (Thyroxine)"). Matching the instrument CODE against these is far more
    // precise than a loose substring on the name (it won't map T3 to "Free T3",
    // since that one carries "(FT3)" / leads with "Free"), so it correctly
    // resolves the immunoassay channels a plain fuzzy pass leaves unmapped.
    const abbr = matchTestByCodeAbbreviation(c, tests)
    if (abbr) {
      return {
        lisTestId: abbr.id,
        lisTestCode: abbr.testCode,
        lisTestName: abbr.testName,
        confidence: 0.9
      }
    }

    // 3) Fuzzy: test name contains the analyte name token. Require both sides to
    // be >= 4 chars so a test literally named "M" can't swallow "Monocytes".
    if (name && name.trim().length >= 4) {
      const n = name.toLowerCase().trim()
      const fuzzy = tests.find((t) => {
        const tn = t.testName.toLowerCase().trim()
        if (tn.length < 4) return false
        return tn.includes(n) || n.includes(tn)
      })
      if (fuzzy) {
        return {
          lisTestId: fuzzy.id,
          lisTestCode: fuzzy.testCode,
          lisTestName: fuzzy.testName,
          confidence: 0.6
        }
      }
    }

    return null
  }

  /**
   * One-time hygiene: a Beckman AU configures two methods for each bilirubin
   * analyte — DCA (DBILC/TBILC, online nos 6/8) and BuBc (DBILB/TBILB, nos 7/9) —
   * and both can end up mapped to the SAME LIS test. The host query would then
   * order both methods (6+7, 8+9), whereas the live reference interface orders
   * only one. A lab runs a single bilirubin method, so when the DCA variant is
   * mapped we drop the redundant BuBc variant (back to 'unmapped'). Guarded by a
   * persisted flag and only fires when the DCA counterpart is actually mapped, so
   * a site that deliberately uses ONLY BuBc (DBILB mapped, DBILC not) is left
   * untouched, and an operator's later manual re-map is never reverted.
   */
  migrateAuSingleBilirubinMethod(): number {
    if (persist.getMigrationFlag('migratedAuSingleBilirubin')) return 0
    const pairs: Array<[primary: string, secondary: string]> = [
      ['DBILC', 'DBILB'],
      ['TBILC', 'TBILB']
    ]
    const isMapped = (r?: MappingRule): boolean =>
      !!r && (r.status === 'auto' || r.status === 'manual') && (!!r.lisTestId || !!r.lisTestCode)
    let changed = 0
    for (const rule of this.rules) {
      if (rule.driverId !== 'beckman-au480') continue
      const pair = pairs.find(([, secondary]) => secondary === rule.instrumentCode)
      if (!pair) continue
      if (!isMapped(rule)) continue
      const primary = this.rules.find(
        (r) => r.driverId === 'beckman-au480' && r.instrumentCode === pair[0]
      )
      if (!isMapped(primary)) continue // DCA not in use here — leave BuBc as the lab set it
      Object.assign(rule, {
        status: 'unmapped',
        confidence: undefined,
        lisTestId: undefined,
        lisTestCode: undefined,
        lisTestName: undefined,
        lisParamId: undefined,
        lisParamName: undefined,
        updatedAt: new Date().toISOString()
      })
      changed++
    }
    persist.setMigrationFlag('migratedAuSingleBilirubin', true)
    if (changed > 0) {
      this.save()
      logger.info(
        'mapping',
        `AU bilirubin hygiene: un-mapped ${changed} redundant BuBc method row(s) (single DCA method retained)`
      )
    }
    return changed
  }

  /**
   * Resolve ONLY currently-unmapped rows for the given drivers, leaving every
   * 'auto', 'manual' and 'ignored' rule untouched. Run at startup so analytes
   * that seeding could not match (e.g. immunoassay channels whose LIS names only
   * carry the mnemonic) are filled BEFORE the first host query, without churning
   * mappings an operator already curated. Best-effort: a missing LIS is ignored.
   */
  async resolveUnmappedForDrivers(driverIds: string[]): Promise<number> {
    const unique = [...new Set(driverIds)]
    if (unique.length === 0) return 0
    if (!this.rules.some((r) => unique.includes(r.driverId) && r.status === 'unmapped')) return 0
    let tests: LisTest[] = []
    let params: LisParameter[] = []
    try {
      tests = await this.lis.getTests()
      params = await this.lis.getParameters()
    } catch {
      return 0 // LIS unavailable — leave unmapped, retried on result receive
    }
    let changed = 0
    for (const rule of this.rules) {
      if (!unique.includes(rule.driverId) || rule.status !== 'unmapped') continue
      const target = this.suggest(rule.instrumentCode, rule.instrumentName, tests, params)
      if (!target) continue
      Object.assign(rule, {
        status: 'auto',
        confidence: target.confidence,
        lisTestId: target.lisTestId,
        lisTestCode: target.lisTestCode,
        lisTestName: target.lisTestName,
        lisParamId: target.lisParamId,
        lisParamName: target.lisParamName,
        updatedAt: new Date().toISOString()
      })
      changed++
    }
    if (changed > 0) {
      this.save()
      logger.info('mapping', `Resolved ${changed} previously-unmapped analyte(s) for [${unique.join(', ')}]`)
    }
    return changed
  }

  /** Re-run auto-mapping for a driver's currently unmapped rows. */
  async autoMap(driverId: string): Promise<MappingRule[]> {
    const tests = await this.lis.getTests()
    const params = await this.lis.getParameters()
    let changed = 0
    for (const rule of this.rules) {
      if (rule.driverId !== driverId) continue
      if (rule.status === 'manual' || rule.status === 'ignored') continue
      const target = this.suggest(rule.instrumentCode, rule.instrumentName, tests, params)
      if (target) {
        Object.assign(rule, {
          status: 'auto',
          confidence: target.confidence,
          lisTestId: target.lisTestId,
          lisTestCode: target.lisTestCode,
          lisTestName: target.lisTestName,
          lisParamId: target.lisParamId,
          lisParamName: target.lisParamName,
          updatedAt: new Date().toISOString()
        })
        changed++
      }
    }
    if (changed > 0) this.save()
    logger.info('mapping', `Auto-mapped ${changed} analytes for ${driverId}`)
    return this.list(driverId)
  }

  /**
   * Restrict a driver's LIS posting to an allow-list of analyte codes. Any
   * auto-mapped rule whose analyte is not in the list is set to 'ignored', so
   * the value is still decoded/visible in Synapse but never written to the LIS.
   * Manual and already-ignored/unmapped rules are left untouched, so an operator
   * can re-enable an analyte from the UI without it being reverted on restart.
   */
  /**
   * One-time: re-enable LD-560 calculated-eAG LIS posting. Earlier builds locked
   * the LD-560 LIS scope to HbA1c only, leaving the eAG rule 'ignored' even
   * though it already resolves to Noble's "Estimated Average Glucose (eAG)"
   * parameter. Now the calculated eAG is posted alongside HbA1c, so flip a
   * mapped-but-ignored eAG rule back to 'auto'. Guarded by a persisted flag, and
   * only touches a rule that already has a LIS target — so an operator's later
   * manual ignore is never reverted.
   */
  migrateLd560EnableEag(): number {
    if (persist.getMigrationFlag('migratedLd560EnableEag')) return 0
    let changed = 0
    for (const rule of this.rules) {
      if (rule.driverId !== 'landwind-ld-560') continue
      if (rule.instrumentCode.toLowerCase() !== 'eag') continue
      if (rule.status !== 'ignored') continue
      if (!rule.lisTestId && !rule.lisTestCode && !rule.lisParamId && !rule.lisParamName) continue
      rule.status = 'auto'
      rule.updatedAt = new Date().toISOString()
      changed++
    }
    persist.setMigrationFlag('migratedLd560EnableEag', true)
    if (changed > 0) {
      this.save()
      logger.info('mapping', `LD-560 calculated-eAG LIS posting re-enabled (${changed} rule)`)
    }
    return changed
  }

  restrictLisScope(driverId: string, allowedCodes: readonly string[]): number {
    const allow = new Set(allowedCodes.map((c) => c.toUpperCase()))
    let changed = 0
    for (const rule of this.rules) {
      if (rule.driverId !== driverId) continue
      // Leave manual overrides and already-ignored rules alone. Flip every other
      // non-allowed analyte (auto or unmapped) to 'ignored' so it can never be
      // written to the LIS — even if it later auto-maps after a cold start.
      if (rule.status === 'manual' || rule.status === 'ignored') continue
      if (allow.has(rule.instrumentCode.toUpperCase())) continue
      rule.status = 'ignored'
      rule.updatedAt = new Date().toISOString()
      changed++
    }
    if (changed > 0) {
      this.save()
      logger.info(
        'mapping',
        `Restricted ${driverId} LIS posting to [${allowedCodes.join(', ')}] — ${changed} analyte(s) set to ignored`
      )
    }
    return changed
  }

  list(driverId?: string): MappingRule[] {
    return driverId ? this.rules.filter((r) => r.driverId === driverId) : [...this.rules]
  }

  upsert(rule: MappingRule): MappingRule {
    const idx = this.rules.findIndex((r) => r.id === rule.id)
    const next = { ...rule, updatedAt: new Date().toISOString() }
    if (idx >= 0) this.rules[idx] = next
    else this.rules.push(next)
    this.save()
    return next
  }

  remove(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id)
    this.save()
  }

  /**
   * Reverse lookup for host-query: given the LIS test codes/names ordered for a
   * sample, return the instrument analyte codes to put in the ASTM O records.
   * Uses the existing mapping rules (instrumentCode <-> lisTestCode/Name), skips
   * unmapped/ignored rules, and de-duplicates (a panel test maps many analytes).
   */
  instrumentCodesForLisTests(
    driverId: string,
    lisTestCodes: readonly string[],
    lisTestNames: readonly string[] = []
  ): string[] {
    const wantCodes = new Set(lisTestCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))
    const wantNames = new Set(lisTestNames.map((n) => n.trim().toUpperCase()).filter(Boolean))
    // Word-order/specimen-suffix tolerant name keys. A lab frequently labels the
    // same analyte differently from the instrument menu — "Total Protein" vs
    // "Protein Total Serum", "Bilirubin Conjugated (Direct) - SERUM" vs the
    // parameter "Bilirubin Conjugated". Comparing sorted token SETS (with generic
    // specimen/method filler words dropped) bridges those without the false
    // positives of a substring match (e.g. "Iron" never swallows "Iron Binding
    // Capacity"). Exact-name hits are a strict subset of this, so it only ever
    // ADDS correct matches, never removes one.
    const wantNameKeys = new Set(lisTestNames.map(normalizeTestNameKey).filter(Boolean))

    // Collect matching rules grouped by the LIS test they resolve to. A single
    // LIS test can have both a generic catalog row (code "TSH", auto) and a
    // real-channel manual row (code "TSH II"). The analyzer only knows its own
    // channel name, so when a manual row exists for a test it shadows the auto
    // one — we never emit an order code the instrument can't recognize.
    const byTest = new Map<string, MappingRule[]>()
    for (const r of this.rules) {
      if (r.driverId !== driverId) continue
      if (r.status === 'unmapped' || r.status === 'ignored') continue
      const codeHit = r.lisTestCode && wantCodes.has(r.lisTestCode.toUpperCase())
      const nameHit =
        (r.lisTestName && wantNames.has(r.lisTestName.toUpperCase())) ||
        (r.lisParamName && wantNames.has(r.lisParamName.toUpperCase()))
      const keyHit =
        (!!r.lisTestName && wantNameKeys.has(normalizeTestNameKey(r.lisTestName))) ||
        (!!r.lisParamName && wantNameKeys.has(normalizeTestNameKey(r.lisParamName)))
      // Variant channels (e.g. AU Glucose / RF): the rule pins ONE LIS variant,
      // but the analyzer's single channel satisfies any ordered variant. Treat it
      // as a hit when the order carries a variant this channel measures, so the
      // online test no. is queried regardless of which variant the doctor chose.
      const variant = auVariantGroup(r.instrumentCode)
      const variantHit = !!variant && lisTestNames.some((n) => variant.matches(n))
      if (!codeHit && !nameHit && !keyHit && !variantHit) continue
      const key = String(r.lisTestId ?? r.lisTestCode ?? r.instrumentCode).toUpperCase()
      const group = byTest.get(key) ?? []
      group.push(r)
      byTest.set(key, group)
    }

    const out: string[] = []
    for (const group of byTest.values()) {
      const manual = group.filter((r) => r.status === 'manual')
      const chosen = manual.length > 0 ? manual : group
      // Send the analyzer's own channel name when set (e.g. MAGLUMI X3 matches the
      // order by Channel No., not our generic code), else the instrument code.
      for (const r of chosen) out.push(r.analyzerCode?.trim() || r.instrumentCode)
    }
    return [...new Set(out)]
  }

  /**
   * Resolve a canonical result to its mapping rule (by driver + analyte code).
   * Matches the instrument code OR the analyzer channel name, since an analyzer
   * that orders by Channel No. also uploads results keyed by it.
   */
  resolve(result: CanonicalResult, driverId: string): MappingRule | undefined {
    const code = result.analyteCode.toUpperCase()
    return this.rules.find(
      (r) =>
        r.driverId === driverId &&
        (r.instrumentCode.toUpperCase() === code ||
          (r.analyzerCode?.trim().toUpperCase() === code && !!r.analyzerCode))
    )
  }

  counts(): { mapped: number; unmapped: number } {
    const mapped = this.rules.filter((r) => r.status === 'auto' || r.status === 'manual').length
    const unmapped = this.rules.filter((r) => r.status === 'unmapped').length
    return { mapped, unmapped }
  }

  private save(): void {
    persist.setMappings(this.rules)
  }
}

/**
 * Canonical Noble CBC parameter-name synonyms for each EDAN H60 / 5-part analyte
 * code. Keyed by the analyte code as emitted by the driver (uppercased). The
 * order within each list is most-specific-first so the "%" differential picks
 * the "… %" parameter, not the bare cell name.
 */
const CBC_PARAM_ALIASES: Record<string, string[]> = {
  WBC: ['total leukocyte count', 'total leucocyte count', 'tlc', 'white blood cell count', 'wbc count'],
  RBC: ['rbc count', 'red blood cell count', 'total rbc count'],
  HGB: ['hemoglobin', 'haemoglobin', 'hb'],
  HCT: ['hematocrit', 'haematocrit', 'packed cell volume', 'pcv'],
  MCV: ['mcv', 'mean corpuscular volume'],
  MCH: ['mch', 'mean corpuscular hemoglobin'],
  MCHC: ['mchc', 'mean corpuscular hemoglobin concentration'],
  RDW_CV: ['rdw cv', 'rdw'],
  RDW_SD: ['rdw sd'],
  PLT: ['platelet count', 'platelets'],
  MPV: ['mpv', 'mean platelet volume'],
  PDW: ['pdw', 'platelet distribution width'],
  PCT: ['plateletcrit'],
  'NEU%': ['neutrophils %', '% neutrophils', 'neutrophil %', 'neutrophils'],
  'LYM%': ['lymphocytes %', '% lymphocytes', 'lymphocyte %', 'lymphocytes'],
  'MON%': ['monocytes %', '% monocytes', 'monocyte %', 'monocytes'],
  'EOS%': ['eosinophils %', '% eosinophils', 'eosinophil %', 'eosinophils'],
  'BAS%': ['basophils %', '% basophils', 'basophil %', 'basophils'],
  'NEU#': ['absolute neutrophil count', 'neutrophils absolute', 'absolute neutrophils'],
  'LYM#': ['absolute lymphocyte count', 'lymphocytes absolute', 'absolute lymphocytes'],
  'MON#': ['absolute monocyte count', 'monocytes absolute', 'absolute monocytes'],
  'EOS#': ['absolute eosinophil count', 'eosinophils absolute', 'absolute eosinophils'],
  'BAS#': ['absolute basophil count', 'basophils absolute', 'absolute basophils']
}

/**
 * Generic specimen/method filler words that distinguish a label cosmetically but
 * not the analyte itself. Dropped before comparing token sets so "Albumin -
 * Serum" == "Albumin" and "Bilirubin Conjugated (Direct)" == "Bilirubin
 * Conjugated". Kept deliberately small — anything that could change the analyte
 * identity (e.g. "total", "free", "direct" as in LDL-Direct already match by
 * code) must NOT be here.
 */
const NAME_FILLER_TOKENS = new Set(['serum', 'plasma', 'blood', 'direct'])

/**
 * Reduce a LIS test/parameter name to an order-independent token-set key for
 * tolerant equality matching: lowercase, strip punctuation, drop filler tokens,
 * de-duplicate, and sort. Returns '' when nothing meaningful remains. Equality
 * of two keys means the names carry the same analyte tokens regardless of word
 * order or specimen suffix — strict enough to avoid substring false positives.
 */
export function normalizeTestNameKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !NAME_FILLER_TOKENS.has(t))
  return [...new Set(tokens)].sort().join(' ')
}

/**
 * Resolve an instrument analyte code to a LIS test whose NAME advertises that
 * exact mnemonic, using two high-precision signals only:
 *   (a) parenthesized abbreviation equal to the code — "... (AMH)", "... (FT3)"
 *   (b) the name begins with the code at a word boundary — "T3 (Tri ...)"
 * Both are anchored so near-neighbours don't collide (code "T3" matches "T3
 * (Tri Iodothyronine)" but NOT "Free T3 (FT3)"). Prefers (a) over (b), then the
 * shortest name. Returns null when no confident single match exists.
 */
function matchTestByCodeAbbreviation(code: string, tests: LisTest[]): LisTest | null {
  const c = code.trim().toUpperCase()
  if (c.length < 2) return null // avoid 1-char codes matching too eagerly
  const parenHits: LisTest[] = []
  const leadHits: LisTest[] = []
  for (const t of tests) {
    // Noble pads many test names with leading/trailing spaces (e.g.
    // " T3 (Tri Iodothyronine ) "), which silently broke startsWith — so the
    // thyroid-profile T3/T4 channels never resolved. Trim before matching.
    const name = t.testName.trim().toUpperCase()
    // (a) "(CODE)" anywhere in the name.
    if (name.includes(`(${c})`)) {
      parenHits.push(t)
      continue
    }
    // (b) name starts with CODE followed by a non-alphanumeric boundary.
    const rest = name.startsWith(c) ? name.charAt(c.length) : ''
    if (name.startsWith(c) && (rest === '' || !/[A-Z0-9]/.test(rest))) {
      leadHits.push(t)
    }
  }
  const pick = (arr: LisTest[]): LisTest | null =>
    arr.length === 0 ? null : arr.sort((a, b) => a.testName.trim().length - b.testName.trim().length)[0]
  return pick(parenHits) ?? pick(leadHits)
}

/** Lowercase a name and collapse separators/punctuation for tolerant matching. */
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s_\-/]+/g, ' ')
    .replace(/[^\w% ]/g, '')
    .trim()
}

/** True when a LIS test name looks like the CBC / hemogram panel. */
function isCbcTestName(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('blood count') ||
    n.includes('cbc') ||
    n.includes('hemogram') ||
    n.includes('haemogram') ||
    n.includes('5 part') ||
    n.includes('5-part')
  )
}

/**
 * Resolve a hematology analyte code to a Noble CBC parameter by curated synonym,
 * preferring a parameter whose parent test is the CBC panel (the same cell name
 * frequently appears in body-fluid / other panels too). Returns null for codes
 * we don't carry a synonym for (e.g. research indices NLR, P_LCC).
 */
function suggestCbcParam(
  code: string,
  tests: LisTest[],
  params: LisParameter[]
): MappingTarget | null {
  // Alias keys use underscores (e.g. RDW_CV), but some drivers emit the same
  // analyte hyphenated (Boule Swelab Lumi / Medonic M51 send RDW-CV / RDW-SD).
  // Normalize '-' -> '_' so both spellings resolve to the same synonym list.
  const aliases = CBC_PARAM_ALIASES[code.trim().toUpperCase().replace(/-/g, '_')]
  if (!aliases) return null
  const aliasNorm = aliases.map(normName)
  const testById = new Map(tests.map((t) => [t.id, t]))

  const cands = params
    .map((p) => {
      const idx = aliasNorm.indexOf(normName(p.name))
      if (idx < 0) return null
      const parent = testById.get(p.testId)
      return { p, parent, cbc: !!parent && isCbcTestName(parent.testName), idx }
    })
    .filter((x): x is NonNullable<typeof x> => x != null)

  if (cands.length === 0) return null
  // CBC-panel match wins; then most-specific synonym; then shortest name.
  cands.sort(
    (a, b) =>
      Number(b.cbc) - Number(a.cbc) || a.idx - b.idx || a.p.name.length - b.p.name.length
  )
  const best = cands[0]
  return {
    lisTestId: best.parent?.id,
    lisTestCode: best.parent?.testCode,
    lisTestName: best.parent?.testName,
    lisParamId: best.p.id,
    lisParamName: best.p.name,
    unit: best.p.unit,
    confidence: best.cbc ? 0.97 : 0.8
  }
}

/** Match Noble parameter rows for LD-560 HbA1c / eAG analytes. */
function paramMatchesAnalyte(
  param: LisParameter,
  code: string,
  name?: string
): boolean {
  const n = param.name.toLowerCase()
  const c = code.trim()
  if (c === 'HbA1c' || c === 'S-A1c') {
    return n.includes('hba1c') && !n.includes('eag')
  }
  if (c === 'eAG') {
    return n.includes('eag') || n.includes('estimated average glucose')
  }
  if (name && n.includes(name.toLowerCase())) return true
  return param.code.toUpperCase() === c.toUpperCase()
}

/** Noble expects eAG in mg/dL; analyzer reports mmol/L. */
function lisUnitForAnalyte(code: string, paramUnit?: string): string | undefined {
  if (code === 'eAG') return 'mg/dL'
  return paramUnit
}

/** Driver id helper (kept here to avoid circular imports in callers). */
export function driverExists(id: string): boolean {
  return !!getDriver(id)
}
