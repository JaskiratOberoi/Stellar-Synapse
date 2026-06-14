import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type {
  CanonicalResult,
  InstrumentDefinition,
  InstrumentRuntime,
  MonitorEvent,
  ConnectionStatus
} from '../../../shared/types'
import type { ITransport } from '../connection/ITransport'
import { createTransport } from '../connection/factory'
import { createProtocol } from '../protocols/registry'
import type { IProtocol, ProtocolMessage } from '../protocols/IProtocol'
import { getDriver } from '../drivers/registry'
import { fingerprintInstrument } from '../discovery/fingerprint'
import type { ILisRepository } from '../lis/ILisRepository'
import { MappingEngine } from '../mapping/MappingEngine'
import { persist } from '../../store'
import { logger } from '../logger'

interface RunningConnection {
  transport: ITransport
  protocol: IProtocol
}

/**
 * The Orchestrator wires the full pipeline together:
 *   transport -> protocol decoder -> driver -> mapping -> LIS repository
 * and emits runtime state + monitor events for the UI.
 */
export class Orchestrator extends EventEmitter {
  readonly mapping: MappingEngine
  private runtimes = new Map<string, InstrumentRuntime>()
  private connections = new Map<string, RunningConnection>()
  private monitorBuffer: MonitorEvent[] = []
  private readonly maxMonitor = 300
  // Auto-identify / converge state for discovery taps.
  private tapBuffers = new Map<string, string>()
  private identifiedTaps = new Set<string>()
  private consolidateTimers = new Map<string, NodeJS.Timeout>()
  private readonly consolidateGraceMs = 12000

  constructor(private readonly lis: ILisRepository) {
    super()
    this.mapping = new MappingEngine(lis)
  }

  async init(): Promise<void> {
    // Seed mappings only for drivers actually in use (keeps the store small even
    // with a large model catalog).
    await this.mapping.seedDrivers(persist.getInstruments().map((i) => i.driverId))
    for (const def of persist.getInstruments()) {
      this.runtimes.set(def.id, this.toRuntime(def, 'offline'))
    }
    // Auto-start enabled instruments.
    for (const def of persist.getInstruments()) {
      if (def.enabled) await this.startInstrument(def.id).catch(() => undefined)
    }
    this.emitInstruments()
  }

  // ----- instrument CRUD -----------------------------------------------------

  listInstruments(): InstrumentRuntime[] {
    return [...this.runtimes.values()]
  }

  async addInstrument(input: Omit<InstrumentDefinition, 'id' | 'createdAt'>): Promise<InstrumentRuntime> {
    const def: InstrumentDefinition = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    }
    const all = persist.getInstruments()
    all.push(def)
    persist.setInstruments(all)
    this.runtimes.set(def.id, this.toRuntime(def, 'offline'))
    logger.info('engine', `Added instrument ${def.name} (${def.driverId})`)
    // Lazily seed this driver's analyte mappings now that it's in use.
    const added = await this.mapping.seedDrivers([def.driverId])
    if (added > 0) this.emit('mappings', this.mapping.list())
    if (def.enabled) await this.startInstrument(def.id).catch(() => undefined)
    this.emitInstruments()
    return this.runtimes.get(def.id)!
  }

  async updateInstrument(
    id: string,
    patch: Partial<InstrumentDefinition>
  ): Promise<InstrumentRuntime> {
    const all = persist.getInstruments()
    const idx = all.findIndex((i) => i.id === id)
    if (idx < 0) throw new Error(`Instrument ${id} not found`)
    const wasRunning = this.connections.has(id)
    if (wasRunning) await this.stopInstrument(id)
    all[idx] = { ...all[idx], ...patch, id }
    persist.setInstruments(all)
    const current = this.runtimes.get(id)!
    this.runtimes.set(id, { ...current, ...all[idx] })
    if (all[idx].enabled) await this.startInstrument(id).catch(() => undefined)
    this.emitInstruments()
    return this.runtimes.get(id)!
  }

  async removeInstrument(id: string): Promise<void> {
    await this.stopInstrument(id).catch(() => undefined)
    persist.setInstruments(persist.getInstruments().filter((i) => i.id !== id))
    this.runtimes.delete(id)
    this.identifiedTaps.delete(id)
    this.tapBuffers.delete(id)
    this.emitInstruments()
  }

  // ----- start / stop --------------------------------------------------------

  async startInstrument(id: string): Promise<InstrumentRuntime> {
    const def = persist.getInstruments().find((i) => i.id === id)
    if (!def) throw new Error(`Instrument ${id} not found`)
    if (this.connections.has(id)) return this.runtimes.get(id)!

    const driver = getDriver(def.driverId)
    if (!driver) throw new Error(`Driver ${def.driverId} not registered`)

    const transport = createTransport(def.id, def.connection)
    const protocol = createProtocol(def.protocol)

    transport.on('status', (status: ConnectionStatus, peer?: string) => {
      this.patchRuntime(id, { status, peer })
    })
    transport.on('error', () => this.patchRuntime(id, { errors: (this.runtimes.get(id)?.errors ?? 0) + 1 }))
    transport.on('data', (chunk: Buffer) => {
      // Passive taps surface every inbound byte (even undecodable ones) so an
      // unknown analyzer's protocol can be inspected/fingerprinted.
      if (def.connection.passive) {
        this.pushRawReceived(id, def.name, chunk)
        if (def.connection.autoIdentify) this.handleTapData(id, def, chunk.toString('latin1'))
      }
      const messages = protocol.feed(chunk)
      for (const msg of messages) this.processMessage(id, msg)
    })

    try {
      await transport.start()
      this.connections.set(id, { transport, protocol })
      logger.info('engine', `Started ${def.name}`)
    } catch (err) {
      this.patchRuntime(id, { status: 'error' })
      logger.error('engine', `Failed to start ${def.name}: ${(err as Error).message}`)
    }
    this.emitInstruments()
    return this.runtimes.get(id)!
  }

  async stopInstrument(id: string): Promise<InstrumentRuntime> {
    const conn = this.connections.get(id)
    if (conn) {
      await conn.transport.stop().catch(() => undefined)
      conn.protocol.reset()
      this.connections.delete(id)
    }
    this.patchRuntime(id, { status: 'offline', peer: undefined })
    this.emitInstruments()
    return this.runtimes.get(id)!
  }

  // ----- pipeline ------------------------------------------------------------

  /** Run a decoded protocol message through driver -> mapping -> LIS. */
  async processMessage(instrumentId: string, message: ProtocolMessage): Promise<void> {
    const def = persist.getInstruments().find((i) => i.id === instrumentId)
    const driver = def && getDriver(def.driverId)
    if (!def || !driver) return

    this.patchRuntime(instrumentId, {
      messagesReceived: (this.runtimes.get(instrumentId)?.messagesReceived ?? 0) + 1,
      lastMessageAt: new Date().toISOString()
    })

    const results = driver.parse(message, instrumentId)
    for (const result of results) {
      await this.processResult(def, driver.info.id, result, message.raw)
    }
  }

  private async processResult(
    def: InstrumentDefinition,
    driverId: string,
    result: CanonicalResult,
    raw: string
  ): Promise<void> {
    const base = {
      id: randomUUID(),
      instrumentId: def.id,
      instrumentName: def.name,
      sampleId: result.sampleId,
      analyteCode: result.analyteCode,
      analyteName: result.analyteName,
      value: result.value,
      unit: result.unit,
      flag: result.flag,
      raw: raw.length > 600 ? `${raw.slice(0, 600)}...` : raw,
      timestamp: new Date().toISOString()
    }

    this.pushMonitor({ ...base, id: randomUUID(), stage: 'decoded' })

    const rule = this.mapping.resolve(result, driverId)
    if (!rule || rule.status === 'unmapped' || !rule.lisTestId) {
      this.pushMonitor({
        ...base,
        id: randomUUID(),
        stage: 'skipped',
        message: `No LIS mapping for analyte "${result.analyteCode}"`
      })
      return
    }
    if (rule.status === 'ignored') {
      this.pushMonitor({ ...base, id: randomUUID(), stage: 'skipped', message: 'Analyte ignored' })
      return
    }

    const mappedTo = rule.lisParamName
      ? `${rule.lisParamName} (${rule.lisTestName})`
      : rule.lisTestName

    this.pushMonitor({ ...base, id: randomUUID(), stage: 'mapped', mappedTo })

    // Passive tap: import into Synapse only. Never write to the LIS/Noble DB.
    if (def.connection.passive) {
      this.patchRuntime(def.id, {
        resultsProcessed: (this.runtimes.get(def.id)?.resultsProcessed ?? 0) + 1
      })
      this.pushMonitor({
        ...base,
        id: randomUUID(),
        stage: 'skipped',
        mappedTo,
        message: 'Imported (passive tap - LIS write disabled)'
      })
      return
    }

    try {
      await this.lis.writeResult({
        vailid: result.sampleId,
        testId: rule.lisTestId,
        paramId: rule.lisParamId,
        testCode: rule.lisTestCode ?? '',
        testName: rule.lisTestName ?? '',
        value: result.value,
        unit: result.unit ?? rule.unit,
        abnormal: !!result.flag && result.flag !== 'N',
        machineName: def.name.slice(0, 20),
        uploadFlag: 'Y',
        addedDate: new Date().toISOString()
      })
      this.patchRuntime(def.id, {
        resultsProcessed: (this.runtimes.get(def.id)?.resultsProcessed ?? 0) + 1
      })
      this.pushMonitor({ ...base, id: randomUUID(), stage: 'written', mappedTo })
    } catch (err) {
      this.pushMonitor({
        ...base,
        id: randomUUID(),
        stage: 'error',
        mappedTo,
        message: (err as Error).message
      })
    }
  }

  // ----- monitor + runtime helpers ------------------------------------------

  recentMonitor(): MonitorEvent[] {
    return [...this.monitorBuffer]
  }

  // ----- discovery tap auto-identify + converge -----------------------------

  /** Handle inbound data on an auto-identify tap: fingerprint, then consolidate. */
  private handleTapData(id: string, def: InstrumentDefinition, text: string): void {
    // Any real data means this host has a live instrument: schedule pruning of
    // sibling taps that received nothing.
    this.scheduleConsolidation(def.connection.host)

    if (this.identifiedTaps.has(id)) return
    const buf = ((this.tapBuffers.get(id) ?? '') + text).slice(-4096)
    this.tapBuffers.set(id, buf)

    const fp = fingerprintInstrument(buf)
    if (!fp) return
    this.identifiedTaps.add(id)
    this.tapBuffers.delete(id)
    logger.info(
      'discovery',
      `Identified ${def.name} as ${fp.vendor} ${fp.model} ` +
        `(${fp.driverId}, ${Math.round(fp.confidence * 100)}%) via "${fp.evidence}"`
    )
    void this.applyIdentity(id, def, fp)
  }

  /** Adopt the fingerprinted driver/protocol for a tap and reseed its mappings. */
  private async applyIdentity(
    id: string,
    def: InstrumentDefinition,
    fp: ReturnType<typeof fingerprintInstrument>
  ): Promise<void> {
    if (!fp) return
    const host = def.connection.host ?? ''
    const port = def.connection.port ?? ''
    const name = `${fp.model} @ ${host}:${port}`
    await this.updateInstrument(id, {
      name,
      driverId: fp.driverId,
      protocol: fp.protocol
    }).catch((err) => logger.warn('discovery', `Identity update failed: ${(err as Error).message}`))
    const added = await this.mapping.seedDrivers([fp.driverId])
    if (added > 0) this.emit('mappings', this.mapping.list())
  }

  /** Debounced per-host consolidation: prune silent sibling taps once one has data. */
  private scheduleConsolidation(host?: string): void {
    if (!host || this.consolidateTimers.has(host)) return
    const timer = setTimeout(() => {
      this.consolidateTimers.delete(host)
      void this.consolidateGroup(host)
    }, this.consolidateGraceMs)
    this.consolidateTimers.set(host, timer)
  }

  private async consolidateGroup(host: string): Promise<void> {
    const taps = persist
      .getInstruments()
      .filter((i) => i.connection.autoIdentify && i.connection.passive && i.connection.host === host)
    if (taps.length <= 1) return

    const received = (i: InstrumentDefinition): number =>
      this.runtimes.get(i.id)?.messagesReceived ?? 0
    const withData = taps.filter((i) => received(i) > 0)
    if (withData.length === 0) return // nothing yet; keep all taps listening

    const silent = taps.filter((i) => received(i) === 0)
    for (const tap of silent) {
      logger.info(
        'discovery',
        `Pruning silent tap ${tap.name} - no data on ${host}:${tap.connection.port}`
      )
      await this.removeInstrument(tap.id).catch(() => undefined)
    }
  }

  /** Surface raw inbound bytes from a passive tap as a 'received' monitor event. */
  private pushRawReceived(instrumentId: string, instrumentName: string, chunk: Buffer): void {
    const text = chunk.toString('latin1')
    const printable = text.replace(/[\x00-\x08\x0e-\x1f\x7f]/g, (c) => `<${c.charCodeAt(0)}>`)
    this.patchRuntime(instrumentId, {
      messagesReceived: (this.runtimes.get(instrumentId)?.messagesReceived ?? 0) + 1,
      lastMessageAt: new Date().toISOString()
    })
    this.pushMonitor({
      id: randomUUID(),
      instrumentId,
      instrumentName,
      sampleId: '-',
      analyteCode: 'RAW',
      analyteName: 'Raw inbound frame',
      value: `${chunk.length} bytes`,
      raw: printable.length > 600 ? `${printable.slice(0, 600)}...` : printable,
      stage: 'received',
      timestamp: new Date().toISOString()
    })
  }

  private pushMonitor(evt: MonitorEvent): void {
    this.monitorBuffer.unshift(evt)
    if (this.monitorBuffer.length > this.maxMonitor) this.monitorBuffer.pop()
    this.emit('monitor', evt)
  }

  private toRuntime(def: InstrumentDefinition, status: ConnectionStatus): InstrumentRuntime {
    return {
      ...def,
      status,
      messagesReceived: 0,
      resultsProcessed: 0,
      errors: 0
    }
  }

  private patchRuntime(id: string, patch: Partial<InstrumentRuntime>): void {
    const current = this.runtimes.get(id)
    if (!current) return
    this.runtimes.set(id, { ...current, ...patch })
    this.emitInstruments()
  }

  private emitInstruments(): void {
    this.emit('instruments', this.listInstruments())
  }

  /** Used by the simulator: is this instrument currently connected/listening? */
  isActive(id: string): boolean {
    const rt = this.runtimes.get(id)
    return !!rt && (rt.status === 'online' || rt.status === 'listening')
  }

  /** Used by the simulator: feed a raw frame through an instrument's decoder. */
  injectRaw(instrumentId: string, raw: string): void {
    const def = persist.getInstruments().find((i) => i.id === instrumentId)
    const conn = this.connections.get(instrumentId)
    if (!def || !conn) return
    // Reuse the live decoder so the simulator exercises real parsing code.
    const anyProto = conn.protocol as unknown as {
      feedText?: (t: string) => ProtocolMessage[]
    }
    const messages = anyProto.feedText
      ? anyProto.feedText(raw)
      : conn.protocol.feed(Buffer.from(raw))
    for (const msg of messages) this.processMessage(instrumentId, msg)
  }
}
