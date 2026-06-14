import type { Orchestrator } from '../engine/Orchestrator'
import { getDriver } from '../drivers/registry'
import { persist } from '../../store'
import { randomSampleId } from '../drivers/sampleBuilders'
import { MOCK_ORDERS } from '../lis/mockData'
import { logger } from '../logger'

/**
 * Instrument simulator. For each active instrument it periodically builds a
 * realistic raw protocol frame (via that instrument's driver) and injects it
 * into the orchestrator pipeline, so the Dashboard, Live Monitor and Mapping
 * screens look alive during review without real hardware.
 */
export class Simulator {
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly orchestrator: Orchestrator) {}

  get running(): boolean {
    return this.timer !== null
  }

  start(ratePerMin = 6): void {
    this.stop()
    const intervalMs = Math.max(2000, Math.round(60000 / Math.max(1, ratePerMin)))
    this.timer = setInterval(() => this.tick(), intervalMs)
    logger.info('simulator', `Started (~${ratePerMin}/min per active instrument)`)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      logger.info('simulator', 'Stopped')
    }
  }

  /** Emit one sample for a specific instrument (or a random active one). */
  emitOne(instrumentId?: string): void {
    const active = persist
      .getInstruments()
      .filter((i) => this.orchestrator.isActive(i.id))
    if (active.length === 0) return
    const target = instrumentId
      ? active.find((i) => i.id === instrumentId)
      : active[Math.floor(Math.random() * active.length)]
    if (target) this.emitFor(target.id, target.driverId)
  }

  private tick(): void {
    const active = persist.getInstruments().filter((i) => this.orchestrator.isActive(i.id))
    for (const inst of active) {
      // Stagger: each active instrument has a chance to emit per tick.
      if (Math.random() < 0.7) this.emitFor(inst.id, inst.driverId)
    }
  }

  private emitFor(instrumentId: string, driverId: string): void {
    const driver = getDriver(driverId)
    if (!driver) return
    const analytes = driver.analytes()
    // Pick a random subset (1-4 analytes) to resemble a real panel.
    const count = 1 + Math.floor(Math.random() * Math.min(4, analytes.length))
    const shuffled = [...analytes].sort(() => Math.random() - 0.5).slice(0, count)
    // Occasionally reuse a known order barcode so order-lookup demos work.
    const sampleId =
      Math.random() < 0.3
        ? MOCK_ORDERS[Math.floor(Math.random() * MOCK_ORDERS.length)].vailid
        : randomSampleId()
    const raw = driver.buildSample(sampleId, shuffled)
    this.orchestrator.injectRaw(instrumentId, raw)
  }
}
