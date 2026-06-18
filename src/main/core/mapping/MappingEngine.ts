import { randomUUID } from 'node:crypto'
import type { CanonicalResult, LisParameter, LisTest, MappingRule } from '../../../shared/types'
import type { ILisRepository } from '../lis/ILisRepository'
import { getDriver } from '../drivers/registry'
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
    for (const driverId of unique) {
      const driver = getDriver(driverId)
      if (!driver) continue
      for (const analyte of driver.analytes()) {
        const exists = this.rules.find(
          (r) => r.driverId === driverId && r.instrumentCode === analyte.code
        )
        if (exists) continue
        const target = this.suggest(analyte.code, analyte.name, tests, params)
        this.rules.push({
          id: randomUUID(),
          driverId,
          instrumentCode: analyte.code,
          instrumentName: analyte.name,
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

    if (added > 0) {
      this.save()
      logger.info('mapping', `Seeded ${added} mapping rows for ${unique.length} in-use driver(s)`)
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

    // 3) Fuzzy: test name contains the analyte name token.
    if (name) {
      const n = name.toLowerCase()
      const fuzzy = tests.find(
        (t) => t.testName.toLowerCase().includes(n) || n.includes(t.testName.toLowerCase())
      )
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
      const nameHit = r.lisTestName && wantNames.has(r.lisTestName.toUpperCase())
      if (!codeHit && !nameHit) continue
      const key = String(r.lisTestId ?? r.lisTestCode ?? r.instrumentCode).toUpperCase()
      const group = byTest.get(key) ?? []
      group.push(r)
      byTest.set(key, group)
    }

    const out: string[] = []
    for (const group of byTest.values()) {
      const manual = group.filter((r) => r.status === 'manual')
      const chosen = manual.length > 0 ? manual : group
      for (const r of chosen) out.push(r.instrumentCode)
    }
    return [...new Set(out)]
  }

  /** Resolve a canonical result to its mapping rule (by driver + analyte code). */
  resolve(result: CanonicalResult, driverId: string): MappingRule | undefined {
    return this.rules.find(
      (r) =>
        r.driverId === driverId &&
        r.instrumentCode.toUpperCase() === result.analyteCode.toUpperCase()
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
