import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type {
  CanonicalResult,
  InstrumentDefinition,
  InstrumentRuntime,
  LisResultWrite,
  MappingRule,
  MonitorEvent,
  ConnectionStatus
} from '../../../shared/types'
import type { ITransport } from '../connection/ITransport'
import { createTransport } from '../connection/factory'
import { InstrumentPollScheduler } from '../connection/InstrumentPollScheduler'
import { createProtocol } from '../protocols/registry'
import type { IProtocol, ProtocolMessage } from '../protocols/IProtocol'
import { AstmHostQuerySender, buildAstmOrderRecords } from '../protocols/astmHostQuery'
import { extractAstmQuery } from '../drivers/parsing'
import { getDriver } from '../drivers/registry'
import { fingerprintInstrument } from '../discovery/fingerprint'
import type { ILisRepository } from '../lis/ILisRepository'
import { MappingEngine } from '../mapping/MappingEngine'
import { persist } from '../../store'
import { logger } from '../logger'
import { normalizeLd560Raw, parseLd560SampleFromRaw, LD560_LIS_ANALYTES } from '../../../shared/ld560Transmit'

interface RunningConnection {
  transport: ITransport
  protocol: IProtocol
  /** Outbound ASTM sender for host-query (order) responses (bidirectional only). */
  sender?: AstmHostQuerySender
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
  private readonly maxMonitor = 2000
  // Offline LIS write queue: results captured while the LIS is unreachable,
  // flushed automatically when it returns. Survives restarts (persisted).
  private pendingWrites: LisResultWrite[] = []
  private readonly maxPending = 1000
  private flushing = false
  private flushTimer: NodeJS.Timeout | null = null
  // Auto-identify / converge state for discovery taps.
  private tapBuffers = new Map<string, string>()
  private identifiedTaps = new Set<string>()
  private consolidateTimers = new Map<string, NodeJS.Timeout>()
  private readonly consolidateGraceMs = 12000
  private pollSchedulers = new Map<string, InstrumentPollScheduler>()

  constructor(private readonly lis: ILisRepository) {
    super()
    this.mapping = new MappingEngine(lis)
  }

  async init(): Promise<void> {
    this.rehydrateLd560FromStoredRaw()
    // Restore persisted monitor history, counters, and the offline LIS queue.
    this.monitorBuffer = persist.getMonitorHistory()
    this.pendingWrites = persist.getPendingWrites()
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

    // Begin draining any results queued while the LIS was down, and keep retrying.
    this.startFlushLoop()
    void this.flushPendingWrites()
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
    persist.removeInstrumentStats(id)
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

    // Wire low-level protocol control bytes (e.g. ASTM E1381 ENQ->ACK and
    // per-frame ACK) back to the analyzer. The ASTM decoder emits these via its
    // `onControl` hook as it parses; without writing them to the socket the
    // analyzer never gets an ACK and reports a communication timeout.
    const ctrlProto = protocol as unknown as { onControl?: (byte: number) => void }
    ctrlProto.onControl = (byte: number): void => {
      if (!def.connection.passive) transport.write(Buffer.from([byte]))
    }

    // Outbound ASTM sender for answering host queries (bidirectional ASTM only).
    const sender =
      def.protocol === 'astm' && def.connection.hostQuery && !def.connection.passive
        ? new AstmHostQuerySender(
            (b) => transport.write(b),
            (m) => logger.info('host-query', `${def.name}: ${m}`)
          )
        : undefined

    transport.on('status', (status: ConnectionStatus, peer?: string) => {
      this.patchRuntime(id, { status, peer })
    })
    transport.on('error', () => this.patchRuntime(id, { errors: (this.runtimes.get(id)?.errors ?? 0) + 1 }))
    transport.on('data', (chunk: Buffer) => {
      this.pollSchedulers.get(id)?.touchInbound()
      // While a host-query response is in flight, the analyzer only sends ACK/NAK
      // control bytes — route them to the sender's handshake, not the decoder.
      if (sender?.isBusy()) {
        for (const b of chunk) sender.feedByte(b)
        return
      }
      // Surface every inbound byte so live instruments are debuggable in the UI.
      if (def.connection.passive) {
        this.pushRawReceived(id, def.name, chunk)
        if (def.connection.autoIdentify) this.handleTapData(id, def, chunk.toString('latin1'))
      } else {
        this.pushRawInbound(id, def.name, chunk, true)
      }
      const messages = protocol.feed(chunk)
      let ld560Ack = false
      for (const msg of messages) {
        if (msg.records[0]?.[0]?.toUpperCase() === 'BITMAP') {
          this.patchRuntime(id, {
            messagesReceived: (this.runtimes.get(id)?.messagesReceived ?? 0) + 1,
            lastMessageAt: new Date().toISOString()
          })
          this.pushMonitor({
            id: randomUUID(),
            instrumentId: id,
            instrumentName: def.name,
            sampleId: '-',
            analyteCode: 'BITMAP',
            analyteName: 'Chromatogram image',
            value: msg.records[0]?.[1] ?? '?',
            stage: 'skipped',
            message:
              'Bitmap/chromatogram data (not a result). On the analyzer: Communication → disable bitmap picture transfer.',
            raw: msg.raw,
            timestamp: new Date().toISOString()
          })
          continue
        }
        void this.processMessage(id, msg)
        if (def.driverId === 'landwind-ld-560') ld560Ack = true
      }
      // ACK + ENQ nudge so the analyzer releases the next queued transmission.
      if (ld560Ack && !def.connection.passive) {
        transport.write('\x06')
        setTimeout(() => transport.write('\x05'), 400)
      }
    })

    try {
      await transport.start()
      this.connections.set(id, { transport, protocol, sender })
      const hasPoll = (def.connection.pollIntervalMs ?? 0) > 0
      const hasIdle = (def.connection.idleReconnectMs ?? 0) > 0
      if ((hasPoll || hasIdle) && !def.connection.passive) {
        const scheduler = new InstrumentPollScheduler(def.name, transport, def.connection)
        scheduler.start()
        this.pollSchedulers.set(id, scheduler)
        if (hasPoll) {
          logger.info('engine', `Poll listener active for ${def.name} (every ${def.connection.pollIntervalMs}ms)`)
        } else {
          logger.info('engine', `Listen-only session for ${def.name} (idle reconnect ${def.connection.idleReconnectMs}ms)`)
        }
      }
      logger.info('engine', `Started ${def.name}`)
    } catch (err) {
      this.patchRuntime(id, { status: 'error' })
      logger.error('engine', `Failed to start ${def.name}: ${(err as Error).message}`)
    }
    this.emitInstruments()
    return this.runtimes.get(id)!
  }

  async stopInstrument(id: string): Promise<InstrumentRuntime> {
    this.pollSchedulers.get(id)?.stop()
    this.pollSchedulers.delete(id)
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

    // Host query (analyzer asks the LIS which tests to run for a barcode).
    if (def.connection.hostQuery && def.protocol === 'astm') {
      const query = extractAstmQuery(message)
      if (query) {
        await this.handleHostQuery(def, driver.info.id, query.sid, message.raw)
        return
      }
    }

    const results = driver.parse(message, instrumentId)
    for (const result of results) {
      await this.processResult(def, driver.info.id, result, message.raw)
    }
  }

  /**
   * Answer an ASTM host query: look up the sample's ordered tests in the LIS,
   * reverse-map the LIS test codes to this analyzer's instrument codes, and
   * transmit ASTM O (order) records back so the analyzer knows what to run.
   */
  private async handleHostQuery(
    def: InstrumentDefinition,
    driverId: string,
    sid: string,
    raw: string
  ): Promise<void> {
    const sender = this.connections.get(def.id)?.sender
    const baseEvent = {
      instrumentId: def.id,
      instrumentName: def.name,
      sampleId: sid,
      analyteCode: 'QUERY',
      analyteName: 'Host query',
      value: '',
      raw: raw.length > 600 ? `${raw.slice(0, 600)}...` : raw,
      timestamp: new Date().toISOString()
    }
    this.pushMonitor({ ...baseEvent, id: randomUUID(), stage: 'received', message: `Host query for ${sid}` })

    let order: Awaited<ReturnType<ILisRepository['getOrder']>> = null
    try {
      order = await this.lis.getOrder(sid)
    } catch (err) {
      logger.warn('host-query', `${def.name}: order lookup failed for ${sid}: ${(err as Error).message}`)
    }

    const codes = order
      ? this.mapping.instrumentCodesForLisTests(driverId, order.testCodes, order.testNames)
      : []

    if (codes.length === 0) {
      logger.info('host-query', `${def.name}: no mappable orders for ${sid} (sending empty order set)`)
      this.pushMonitor({
        ...baseEvent,
        id: randomUUID(),
        stage: 'skipped',
        message: order
          ? `No analytes on this X3 map to the ordered tests [${order.testCodes.join(', ')}]`
          : `Barcode ${sid} not registered in LIS — nothing to order`
      })
    }

    if (!sender) return
    const records = buildAstmOrderRecords(sid, codes, def.name)
    try {
      await sender.send(records)
      logger.info('host-query', `${def.name}: answered ${sid} with ${codes.length} test(s): [${codes.join(', ')}]`)
      this.pushMonitor({
        ...baseEvent,
        id: randomUUID(),
        stage: 'mapped',
        mappedTo: codes.length ? codes.join(', ') : '(none)',
        message: `Ordered ${codes.length} test(s) to analyzer`
      })
    } catch (err) {
      logger.error('host-query', `${def.name}: failed to send orders for ${sid}: ${(err as Error).message}`)
      this.pushMonitor({ ...baseEvent, id: randomUUID(), stage: 'error', message: (err as Error).message })
    }
  }

  private async processResult(
    def: InstrumentDefinition,
    driverId: string,
    result: CanonicalResult,
    raw: string,
    options?: { forceWrite?: boolean }
  ): Promise<'written' | 'skipped' | 'error' | 'queued'> {
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

    let rule = this.mapping.resolve(result, driverId)
    if (
      (!rule || rule.status === 'unmapped' || !rule.lisTestId) &&
      persist.getSettings().autoMapOnReceive
    ) {
      await this.mapping.autoMap(driverId)
      rule = this.mapping.resolve(result, driverId)
    }
    if (!rule || rule.status === 'unmapped' || !rule.lisTestId) {
      this.pushMonitor({
        ...base,
        id: randomUUID(),
        stage: 'skipped',
        message: `No LIS mapping for analyte "${result.analyteCode}"`
      })
      return 'skipped'
    }
    if (rule.status === 'ignored') {
      this.pushMonitor({ ...base, id: randomUUID(), stage: 'skipped', message: 'Analyte ignored' })
      return 'skipped'
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
      return 'skipped'
    }

    // Respect the auto-write toggle (manual backfill passes forceWrite).
    if (this.lis.mode === 'sql' && !persist.getSettings().lisAutoWrite && !options?.forceWrite) {
      this.pushMonitor({
        ...base,
        id: randomUUID(),
        stage: 'skipped',
        mappedTo,
        message: 'LIS auto-write disabled in Settings'
      })
      return 'skipped'
    }

    const { value: writeValue, unit: writeUnit } = convertForLis(result, rule)
    const write: LisResultWrite = {
      vailid: result.sampleId,
      testId: rule.lisTestId,
      paramId: rule.lisParamId,
      testCode: rule.lisTestCode ?? '',
      // Noble labels parameter rows by the parameter name; this is only used when
      // inserting a brand-new row. Existing rows keep their LIS label (the
      // repository UPDATE never touches testname/testcode/testunit).
      testName: rule.lisParamName ?? rule.lisTestName ?? '',
      value: writeValue,
      unit: writeUnit,
      abnormal: !!result.flag && result.flag !== 'N',
      machineName: def.name.slice(0, 20),
      uploadFlag: 'Y',
      addedDate: new Date().toISOString()
    }

    try {
      const outcome = await this.lis.writeResult(write)
      if (outcome === 'skipped') {
        // Sample is registered but this test was not ordered for it — Synapse
        // does not fabricate a row (it would be invisible to Noble's status).
        this.pushMonitor({
          ...base,
          id: randomUUID(),
          stage: 'skipped',
          mappedTo,
          message: `Test not ordered for ${write.vailid} in Noble — value not written`
        })
        return 'skipped'
      }
      this.patchRuntime(def.id, {
        resultsProcessed: (this.runtimes.get(def.id)?.resultsProcessed ?? 0) + 1
      })
      this.pushMonitor({ ...base, id: randomUUID(), stage: 'written', mappedTo })
      return 'written'
    } catch (err) {
      const message = (err as Error).message
      // LIS unreachable: keep the result and retry automatically when it returns.
      if (isLisDownError(err)) {
        this.enqueuePendingWrite(write)
        this.pushMonitor({
          ...base,
          id: randomUUID(),
          stage: 'queued',
          mappedTo,
          message: 'LIS unavailable — queued for retry'
        })
        return 'queued'
      }
      // Sample not registered yet in Noble: skip (a human registers it later).
      if (/not registered|no patient_id/i.test(message)) {
        this.pushMonitor({ ...base, id: randomUUID(), stage: 'skipped', mappedTo, message })
        return 'skipped'
      }
      this.pushMonitor({ ...base, id: randomUUID(), stage: 'error', mappedTo, message })
      return 'error'
    }
  }

  // ----- offline LIS write queue --------------------------------------------

  private startFlushLoop(): void {
    if (this.flushTimer) return
    // Periodically retry queued writes; this is what feeds results into the LIS
    // once it comes back online after an outage.
    this.flushTimer = setInterval(() => void this.flushPendingWrites(), 30_000)
  }

  private enqueuePendingWrite(write: LisResultWrite): void {
    const key = (w: LisResultWrite): string => `${w.vailid}|${w.testId}|${w.paramId ?? 0}`
    // Replace any earlier queued value for the same result slot with the newest.
    this.pendingWrites = this.pendingWrites.filter((w) => key(w) !== key(write))
    this.pendingWrites.push(write)
    if (this.pendingWrites.length > this.maxPending) {
      this.pendingWrites = this.pendingWrites.slice(-this.maxPending)
    }
    persist.setPendingWrites(this.pendingWrites)
  }

  /** Try to drain the offline queue to the LIS. Safe to call repeatedly. */
  async flushPendingWrites(): Promise<{ wrote: number; remaining: number }> {
    if (this.flushing || this.pendingWrites.length === 0 || this.lis.mode !== 'sql') {
      return { wrote: 0, remaining: this.pendingWrites.length }
    }
    this.flushing = true
    let wrote = 0
    try {
      for (const write of [...this.pendingWrites]) {
        try {
          const outcome = await this.lis.writeResult(write)
          // Resolved either way (written or definitively not-ordered): drop it
          // from the queue. Only transient failures (throws) stay queued.
          this.pendingWrites = this.pendingWrites.filter((w) => w !== write)
          if (outcome === 'written') wrote++
          this.pushMonitor({
            id: randomUUID(),
            instrumentId: '',
            instrumentName: 'LIS queue',
            sampleId: write.vailid,
            analyteCode: write.testCode,
            value: write.value,
            unit: write.unit,
            stage: outcome === 'written' ? 'written' : 'skipped',
            mappedTo: write.testName,
            message:
              outcome === 'written'
                ? 'Flushed from offline queue'
                : 'Test not ordered in Noble — dropped from queue',
            timestamp: new Date().toISOString()
          })
        } catch (err) {
          // Still down → stop and keep the rest queued. Other (permanent) errors
          // such as "not registered yet" stay queued for a future attempt.
          if (isLisDownError(err)) break
        }
      }
    } finally {
      if (wrote > 0) {
        persist.setPendingWrites(this.pendingWrites)
        logger.info(
          'lis',
          `Flushed ${wrote} queued result(s) to Noble LIS (${this.pendingWrites.length} remaining)`
        )
      }
      this.flushing = false
    }
    return { wrote, remaining: this.pendingWrites.length }
  }

  /** Number of results currently waiting for the LIS. */
  pendingWriteCount(): number {
    return this.pendingWrites.length
  }

  // ----- monitor + runtime helpers ------------------------------------------

  /**
   * Re-decode stored LD-560 `<TRANSMIT>` RAW frames when older parser runs left
   * bad sample IDs / analyte codes in the activity log.
   */
  private rehydrateLd560FromStoredRaw(): void {
    const history = persist.getMonitorHistory()
    const needsFix = history.some((evt) => {
      const raw = normalizeLd560Raw(evt.raw)
      if (!raw || evt.stage !== 'decoded') return false
      const sample = parseLd560SampleFromRaw(raw)
      if (!sample) return false
      return (
        evt.sampleId !== sample.barcode ||
        !sample.analytes.some((a) => a.code === evt.analyteCode)
      )
    })
    if (!needsFix) return

    const frameMeta = new Map<
      string,
      { timestamp: string; instrumentId: string; instrumentName: string }
    >()
    for (const evt of history) {
      const raw = normalizeLd560Raw(evt.raw)
      if (!raw) continue
      if (!frameMeta.has(raw) || evt.analyteCode === 'RAW') {
        frameMeta.set(raw, {
          timestamp: evt.timestamp,
          instrumentId: evt.instrumentId,
          instrumentName: evt.instrumentName
        })
      }
    }

    const kept: MonitorEvent[] = []
    for (const evt of history) {
      const raw = normalizeLd560Raw(evt.raw)
      if (raw && ['decoded', 'mapped', 'skipped', 'written', 'error'].includes(evt.stage)) {
        continue
      }
      kept.push(evt)
    }

    const additions: MonitorEvent[] = []
    for (const [raw, meta] of frameMeta) {
      const sample = parseLd560SampleFromRaw(raw)
      if (!sample) continue
      for (const a of sample.analytes) {
        additions.push({
          id: randomUUID(),
          instrumentId: meta.instrumentId,
          instrumentName: meta.instrumentName,
          sampleId: sample.barcode,
          analyteCode: a.code,
          value: a.value,
          unit: a.unit,
          stage: 'decoded',
          raw,
          timestamp: meta.timestamp
        })
      }
    }

    const merged = [...additions, ...kept].slice(0, this.maxMonitor)
    persist.setMonitorHistory(merged)
    logger.info('engine', `Re-parsed ${frameMeta.size} LD-560 sample(s) from stored RAW frames`)
  }

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

  /** Surface raw inbound bytes as a 'received' monitor event (passive taps). */
  private pushRawReceived(instrumentId: string, instrumentName: string, chunk: Buffer): void {
    this.pushRawInbound(instrumentId, instrumentName, chunk, true)
  }

  /** Log raw bytes in the live channel; optionally bump the received counter. */
  private pushRawInbound(
    instrumentId: string,
    instrumentName: string,
    chunk: Buffer,
    countAsMessage = false
  ): void {
    const text = chunk.toString('latin1')
    const printable = text.replace(/[\x00-\x08\x0e-\x1f\x7f]/g, (c) => `<${c.charCodeAt(0)}>`)
    this.patchRuntime(instrumentId, {
      ...(countAsMessage
        ? { messagesReceived: (this.runtimes.get(instrumentId)?.messagesReceived ?? 0) + 1 }
        : {}),
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
    persist.prependMonitorEvent(evt)
    this.emit('monitor', evt)
  }

  private toRuntime(def: InstrumentDefinition, status: ConnectionStatus): InstrumentRuntime {
    const saved = persist.getInstrumentStats(def.id)
    return {
      ...def,
      status,
      messagesReceived: saved?.messagesReceived ?? 0,
      resultsProcessed: saved?.resultsProcessed ?? 0,
      errors: saved?.errors ?? 0,
      lastMessageAt: saved?.lastMessageAt
    }
  }

  private patchRuntime(id: string, patch: Partial<InstrumentRuntime>): void {
    const current = this.runtimes.get(id)
    if (!current) return
    const next = { ...current, ...patch }
    this.runtimes.set(id, next)
    if (
      'messagesReceived' in patch ||
      'resultsProcessed' in patch ||
      'lastMessageAt' in patch ||
      'errors' in patch
    ) {
      persist.setInstrumentStats(id, {
        messagesReceived: next.messagesReceived,
        resultsProcessed: next.resultsProcessed,
        errors: next.errors,
        lastMessageAt: next.lastMessageAt
      })
    }
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

  /**
   * Parse a stored RAW frame and write HbA1c panel values to Noble LIS.
   * Used for backfill ("LIS Parse") and manual re-write.
   */
  async parseFrameToLis(
    instrumentId: string,
    raw: string
  ): Promise<{ written: number; skipped: number; errors: number; barcode: string }> {
    const def = persist.getInstruments().find((i) => i.id === instrumentId)
    if (!def) throw new Error(`Instrument ${instrumentId} not found`)

    const normalized = normalizeLd560Raw(raw)
    if (!normalized) throw new Error('Not a valid LD-560 TRANSMIT frame')

    const sample = parseLd560SampleFromRaw(normalized)
    if (!sample) throw new Error('Could not parse stored result frame')

    const order = await this.lis.getOrder(sample.barcode)
    if (!order) {
      throw new Error(`Barcode ${sample.barcode} is not registered in Noble LIS`)
    }

    const lisAnalytes = new Set<string>(LD560_LIS_ANALYTES)
    let written = 0
    let skipped = 0
    let errors = 0
    const now = new Date().toISOString()

    for (const a of sample.analytes) {
      if (!lisAnalytes.has(a.code)) continue
      const result: CanonicalResult = {
        id: randomUUID(),
        instrumentId,
        sampleId: sample.barcode,
        analyteCode: a.code,
        value: a.value,
        unit: a.unit,
        flag: 'N',
        receivedAt: now
      }
      const outcome = await this.processResult(def, def.driverId, result, normalized, {
        forceWrite: true
      })
      if (outcome === 'written') written++
      else if (outcome === 'error') errors++
      else skipped++
    }

    return { written, skipped, errors, barcode: sample.barcode }
  }

  /** Write stored analyzer results for a barcode into Noble LIS (latest frame for barcode). */
  async writeBarcodeToLis(
    instrumentId: string,
    barcode: string
  ): Promise<{ written: number; skipped: number; errors: number }> {
    const raw = this.findStoredRawForBarcode(instrumentId, barcode)
    if (!raw) {
      throw new Error(`No stored analyzer result for barcode ${barcode}`)
    }
    const { written, skipped, errors } = await this.parseFrameToLis(instrumentId, raw)
    return { written, skipped, errors }
  }

  /** Parse every stored frame for this instrument that is not yet in LIS. */
  async parseAllUnwrittenToLis(
    instrumentId: string
  ): Promise<{ frames: number; written: number; skipped: number; errors: number }> {
    const seen = new Set<string>()
    const pending: string[] = []
    for (const evt of this.monitorBuffer) {
      if (evt.instrumentId !== instrumentId) continue
      const raw = normalizeLd560Raw(evt.raw)
      if (!raw || seen.has(raw)) continue
      seen.add(raw)
      if (this.frameWrittenToLis(instrumentId, raw)) continue
      pending.push(raw)
    }

    let written = 0
    let skipped = 0
    let errors = 0
    for (const raw of pending) {
      try {
        const result = await this.parseFrameToLis(instrumentId, raw)
        written += result.written
        skipped += result.skipped
        errors += result.errors
      } catch {
        errors++
      }
    }
    return { frames: pending.length, written, skipped, errors }
  }

  frameWrittenToLis(instrumentId: string, raw: string): boolean {
    const rawNorm = normalizeLd560Raw(raw)
    if (!rawNorm) return false
    const written = this.monitorBuffer.filter((m) => {
      if (m.instrumentId !== instrumentId || m.stage !== 'written') return false
      if (normalizeLd560Raw(m.raw) !== rawNorm) return false
      return (LD560_LIS_ANALYTES as readonly string[]).includes(m.analyteCode)
    })
    // Only HbA1c is posted to the LIS; a frame is "written" once HbA1c lands.
    return written.some((m) => m.analyteCode === 'HbA1c')
  }

  private findStoredRawForBarcode(instrumentId: string, barcode: string): string | null {
    for (const evt of this.monitorBuffer) {
      if (evt.instrumentId !== instrumentId) continue
      const raw = normalizeLd560Raw(evt.raw)
      if (!raw) continue
      const sample = parseLd560SampleFromRaw(raw)
      if (sample?.barcode === barcode) return raw
    }
    return null
  }
}

/**
 * True when an error means the LIS is unreachable (so the write should be queued
 * and retried) rather than a permanent/application error (bad data, not
 * registered). Covers mssql/tedious connection error codes and messages.
 */
function isLisDownError(err: unknown): boolean {
  const e = err as { code?: string; name?: string; message?: string }
  const code = (e?.code ?? '').toUpperCase()
  if (
    ['ELOGIN', 'ESOCKET', 'ETIMEOUT', 'ECONNCLOSED', 'ENOTOPEN', 'ECONNREFUSED', 'EINSTLOOKUP', 'ENOCONN'].includes(
      code
    )
  ) {
    return true
  }
  if (e?.name === 'ConnectionError') return true
  const m = (e?.message ?? '').toLowerCase()
  return /login failed|failed to connect|connection (is )?closed|cannot open|socket hang|timeout|econnrefused|getaddrinfo|not installed/.test(
    m
  )
}

function convertForLis(
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
  return { value: result.value, unit: result.unit ?? rule.unit }
}
