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
import { AstmHostQuerySender, buildAstmOrderRecords, frameAstmSimple } from '../protocols/astmHostQuery'
import { AuHostQuerySender, DEFAULT_AU_FORMAT } from '../protocols/beckmanAu'
import { buildAuOrderResponse, auOnlineTestNo, auVariantGroup } from '../drivers/beckmanAu'
import { MAGLUMI_X3_CHANNELS } from '../drivers/maglumi'
import { applyHba1cDerivations, extractAstmQuery } from '../drivers/parsing'
import { getDriver } from '../drivers/registry'
import type { IInstrumentDriver } from '../drivers/IInstrumentDriver'
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
  /** Outbound Beckman-AU sender for sample-information (S) order responses. */
  auSender?: AuHostQuerySender
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
  // Reconnect catch-up: which instruments have connected at least once this
  // session, and when each last dropped — so a re-connect can pull results the
  // analyzer buffered while we were offline (lab techs sometimes forget to
  // manually re-send reports after a link drop).
  private connectedOnce = new Set<string>()
  private offlineSince = new Map<string, number>()

  constructor(private readonly lis: ILisRepository) {
    super()
    this.mapping = new MappingEngine(lis)
  }

  async init(): Promise<void> {
    this.rehydrateLd560FromStoredRaw()
    // Restore persisted monitor history, counters, and the offline LIS queue.
    this.monitorBuffer = persist.getMonitorHistory()
    this.pendingWrites = persist.getPendingWrites()

    // Show the configured instruments to the UI IMMEDIATELY (as offline), BEFORE
    // any slow LIS or connection work. seedDrivers() below makes a cold call to
    // the (possibly remote) Noble SQL server, which can park init for tens of
    // seconds; if runtimes aren't populated yet, listInstruments() returns an
    // empty map and the UI shows "0 configured" — which looks exactly like an
    // upgrade wiped every instrument. Populate + emit first so it never looks
    // empty on startup; statuses then transition to online as connections come up.
    for (const def of persist.getInstruments()) {
      this.runtimes.set(def.id, this.toRuntime(def, 'offline'))
    }
    this.emitInstruments()

    // Seed mappings only for drivers actually in use (keeps the store small even
    // with a large model catalog). May hit the LIS, but no longer blocks the list.
    await this.mapping.seedDrivers(persist.getInstruments().map((i) => i.driverId))

    // One-time hygiene: keep a single bilirubin method per AU analyte so the host
    // query never double-orders the DCA + BuBc variants (matches the reference).
    this.mapping.migrateAuSingleBilirubinMethod()

    // The Maglumi X3 physically runs only the assays on its panel (TSH II, FT3 II,
    // AMH II, …). Restrict the host query to exactly those channels so unrelated
    // catalog analytes (ATG, CEA, AFP, …) can never be queried or written, no
    // matter what a fuzzy auto-map landed on. Must run BEFORE resolveUnmapped so
    // those non-panel analytes are 'ignored' rather than freshly resolved.
    if (persist.getInstruments().some((i) => i.driverId === 'maglumi-x3')) {
      this.mapping.restrictLisScope('maglumi-x3', Object.keys(MAGLUMI_X3_CHANNELS))
    }

    // Fill any still-unmapped analytes (e.g. immunoassay channels whose LIS names
    // only carry the mnemonic) BEFORE the first host query, so an analyzer that
    // queries immediately on connect gets the full ordered set. Only touches
    // unmapped rows — curated 'auto'/'manual' mappings are left as-is.
    const added2 = await this.mapping
      .resolveUnmappedForDrivers(persist.getInstruments().map((i) => i.driverId))
      .catch(() => 0)
    if (added2 > 0) this.emit('mappings', this.mapping.list())

    // Auto-start enabled instruments CONCURRENTLY: a slow or unreachable analyzer
    // (and its connect timeout) must not delay the others — sequential awaits here
    // were a second source of the startup stall.
    await Promise.all(
      persist
        .getInstruments()
        .filter((def) => def.enabled)
        .map((def) => this.startInstrument(def.id).catch(() => undefined))
    )
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
    const protocol = createProtocol(def.protocol, {
      astmFlushOnTerminator: driver.astmFlushOnTerminator
    })

    // Wire low-level protocol control bytes (e.g. ASTM E1381 ENQ->ACK and
    // per-frame ACK) back to the analyzer. The ASTM decoder emits these via its
    // `onControl` hook as it parses; without writing them to the socket the
    // analyzer never gets an ACK and reports a communication timeout.
    const ctrlProto = protocol as unknown as { onControl?: (byte: number) => void }
    ctrlProto.onControl = (byte: number): void => {
      if (!def.connection.passive) transport.write(Buffer.from([byte]))
    }

    // Surface bytes we transmit (order-download frames + handshake) in the RAW
    // activity log so host-query responses are debuggable, not just inbound data.
    const writeAndLog = (b: Buffer): void => {
      this.pushRawSent(id, def.name, b)
      transport.write(b)
    }

    // Outbound ASTM sender for answering host queries (bidirectional ASTM only).
    const sender =
      def.protocol === 'astm' && def.connection.hostQuery && !def.connection.passive
        ? new AstmHostQuerySender(
            writeAndLog,
            (m) => logger.info('host-query', `${def.name}: ${m}`)
          )
        : undefined

    // Outbound Beckman-AU sender for answering sample-information (R) requests.
    const auSender =
      def.protocol === 'beckman-au' && def.connection.hostQuery && !def.connection.passive
        ? new AuHostQuerySender(
            writeAndLog,
            (m) => logger.info('host-query', `${def.name}: ${m}`),
            DEFAULT_AU_FORMAT
          )
        : undefined

    transport.on('status', (status: ConnectionStatus, peer?: string) => {
      // Analyzers that open a fresh connection per result batch and hang up after
      // (Agappe Mispa Maestro / BH60) would otherwise flap online<->listening on
      // every transmission. Once such an instrument is online, ignore the
      // inter-batch 'listening' so the badge stays steady like a persistently
      // connected analyzer (EDAN H60, Zeus). Stop ('offline') and 'error' still apply.
      if (
        status === 'listening' &&
        driver.transientConnection &&
        this.runtimes.get(id)?.status === 'online'
      ) {
        return
      }
      this.patchRuntime(id, { status, peer })

      // Reconnect catch-up: a fresh 'online' for an instrument we've already seen
      // connected this session means the link dropped and came back. Pull any
      // results the analyzer buffered while we were gone (where the protocol
      // allows). 'listening'/'offline'/'error' mark the start of an offline gap.
      if (status === 'online') {
        const offlineAt = this.offlineSince.get(id)
        this.offlineSince.delete(id)
        const isReconnect = this.connectedOnce.has(id)
        this.connectedOnce.add(id)
        if (isReconnect) this.handleReconnect(id, def, driver, offlineAt)
      } else if (
        status === 'offline' ||
        status === 'error' ||
        status === 'listening' ||
        status === 'connecting'
      ) {
        // Mark the start of the offline window (TcpClient reports a drop as
        // 'connecting' while it retries; a TCP server reports it as 'listening').
        if (!this.offlineSince.has(id)) this.offlineSince.set(id, Date.now())
      }
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
      if (auSender?.isBusy()) {
        for (const b of chunk) auSender.feedByte(b)
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
      this.connections.set(id, { transport, protocol, sender, auSender })
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
    // Operator-initiated stop: forget reconnect state so the next start is a clean
    // first connect (its scheduler already fires an initial catch-up poll), not a
    // "reconnect" that would double up.
    this.connectedOnce.delete(id)
    this.offlineSince.delete(id)
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

  /** Reset the per-instrument error counter (operator clears it from the UI). */
  resetErrors(id: string): InstrumentRuntime | undefined {
    if (!this.runtimes.has(id)) return undefined
    this.patchRuntime(id, { errors: 0 })
    logger.info('engine', `Cleared error count for ${this.runtimes.get(id)?.name ?? id}`)
    return this.runtimes.get(id)
  }

  /**
   * Called when an instrument that was previously connected this session comes
   * back online — i.e. the link dropped and reconnected. Where the protocol
   * allows, nudge the analyzer to re-transmit results it buffered while we were
   * offline so reports generated during the gap aren't lost to a missed manual
   * re-send. Analyzers that only push (no pull command) can't be queried; for
   * those we just flag the gap so the lab verifies nothing was missed.
   */
  private handleReconnect(
    id: string,
    def: InstrumentDefinition,
    driver: IInstrumentDriver,
    offlineAtMs?: number
  ): void {
    // Read-only taps must never transmit; transient-connection analyzers open a
    // fresh socket per batch and push on their own — a pull is wrong for both.
    if (def.connection.passive || driver.transientConnection) return

    const offlineFor =
      offlineAtMs != null ? Math.max(0, Math.round((Date.now() - offlineAtMs) / 1000)) : null
    const gap = offlineFor != null ? ` after ~${offlineFor}s offline` : ''
    const lastData = this.runtimes.get(id)?.lastMessageAt
    const since = lastData ? `; last data was ${lastData}` : ''
    const cmds = def.connection.pollCommands ?? []
    const base = {
      instrumentId: id,
      instrumentName: def.name,
      sampleId: '-',
      analyteCode: 'RECONNECT',
      analyteName: 'Reconnect catch-up',
      value: '',
      timestamp: new Date().toISOString()
    }

    if (cmds.length === 0) {
      // Nothing to pull with — surface the gap so a human can double-check.
      this.pushMonitor({
        ...base,
        id: randomUUID(),
        stage: 'skipped',
        message: `Reconnected${gap} — no pull command configured for this analyzer; verify no reports were missed while offline${since}`
      })
      return
    }

    // Let the freshly-reconnected session settle, then re-send the analyzer's
    // result-request command(s) once. The reply flows back through the normal
    // decode pipeline, so any buffered results are imported/written as usual.
    setTimeout(() => {
      const conn = this.connections.get(id)
      if (!conn || !conn.transport.isRunning()) return
      for (const cmd of cmds) {
        conn.transport.write(cmd)
        this.pushRawSent(id, def.name, Buffer.from(cmd, 'latin1'))
      }
      this.pollSchedulers.get(id)?.touchInbound()
      logger.info(
        'engine',
        `${def.name}: reconnect catch-up — sent ${cmds.length} result-request command(s)`
      )
    }, 600)

    this.pushMonitor({
      ...base,
      id: randomUUID(),
      stage: 'received',
      message: `Reconnected${gap} — requesting any results the analyzer buffered while offline${since}`
    })
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
        await this.handleHostQuery(def, driver.info.id, query.sid, message.raw, {
          analyzerName: query.analyzerName,
          hostName: query.hostName
        })
        return
      }
    }

    // Beckman-AU sample-information request: R|sid|rack|cup|sampleNo|sampleType.
    // The analyzer brackets a host-query batch with bare "RB" (begin) / "RE" (end)
    // markers that carry no sample — only an actual R∆ record (with a sample id or
    // rack/cup position) is an order request. Answering a begin/end marker would
    // push a malformed empty S∆ onto the line, so ignore markers entirely.
    if (def.connection.hostQuery && def.protocol === 'beckman-au') {
      const rec = message.records[0]
      if (rec?.[0] === 'R') {
        const sid = (rec[1] ?? '').trim()
        const rack = (rec[2] ?? '').trim()
        const cup = (rec[3] ?? '').trim()
        const isMarker = !sid && !rack && !cup
        if (isMarker) {
          logger.debug('host-query', `${def.name}: request marker "${message.raw.trim()}" (no sample) — ignored`)
          return
        }
        await this.handleAuHostQuery(def, driver.info.id, {
          sid,
          rack,
          cup,
          sampleNo: rec[4] ?? '',
          raw: message.raw
        })
        return
      }
    }

    let results = driver.parse(message, instrumentId)
    // HbA1c HPLC analyzers (Agappe Mispa Maestro): round to a single decimal and,
    // when enabled, derive Estimated Average Glucose to write alongside HbA1c.
    if (driver.info.derivesEag) {
      results = applyHba1cDerivations(results, {
        autoEag: def.connection.autoEag !== false,
        instrumentId
      })
    }
    await this.reconcileSampleId(def, results)
    // One message can carry several samples; dedupe SIDs within this batch so each
    // sample counts as a single result.
    const countedSids = new Set<string>()
    for (const result of results) {
      await this.processResult(def, driver.info.id, result, message.raw, countedSids)
    }
  }

  /**
   * Resolve which barcode candidate a sample's results should be filed under.
   *
   * Some analyzers can park the scanned sample barcode in more than one field —
   * e.g. an EDAN H60 set to "scan into Patient ID" sends the barcode in the
   * patient field while OBR-2 carries only a short run-sequence number. The
   * driver surfaces the secondary candidate as `altSampleId`; here we verify the
   * primary against the LIS and switch to the alternate when only the alternate
   * is a registered order. This self-corrects in either direction, so it never
   * breaks a correctly-configured (even short) sample id.
   *
   * Runs once per message and only in SQL mode (mock has no real orders to
   * verify against — the driver's offline default stands).
   */
  private async reconcileSampleId(
    def: InstrumentDefinition,
    results: CanonicalResult[]
  ): Promise<void> {
    if (this.lis.mode !== 'sql') return
    const witness = results.find((r) => r.altSampleId && r.altSampleId !== r.sampleId)
    if (!witness) return
    const primary = witness.sampleId
    const alt = witness.altSampleId as string
    try {
      if (primary && (await this.lis.getOrder(primary))) return // primary is valid
      if (!(await this.lis.getOrder(alt))) return // neither registered — keep default
      for (const r of results) r.sampleId = alt
      logger.info(
        'engine',
        `${def.name}: sample id "${primary || '(empty)'}" not in LIS; filing under barcode "${alt}" from the analyzer's patient field`
      )
    } catch (err) {
      logger.warn('engine', `${def.name}: sample-id reconcile failed: ${(err as Error).message}`)
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
    raw: string,
    header?: { analyzerName?: string; hostName?: string }
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
      // Replicate the live ElabAssistLite behaviour exactly: when no test is
      // ordered/mappable for the sample, send NOTHING back (no ENQ, no empty
      // H/P/L). The working interface stays silent ("Order Not Received") and the
      // X3 simply runs nothing for that barcode.
      logger.info('host-query', `${def.name}: no mappable orders for ${sid} — sending nothing (matches eLab)`)
      this.pushMonitor({
        ...baseEvent,
        id: randomUUID(),
        stage: 'skipped',
        value: order ? `${order.testCodes.length} ordered, 0 on X3` : 'not registered',
        message: order
          ? `Ordered tests [${order.testCodes.join(', ')}] — none run on this X3 (no order sent)`
          : `Barcode ${sid} not registered in LIS — nothing to order`
      })
      return
    }

    if (!sender) return
    // Header is sent exactly as the live X3 interface does: literal " MAGLUMI X3 "
    // sender + fixed date "20180319" (handled inside buildAstmOrderRecords). The
    // analyzer's own query header is intentionally NOT echoed — the working
    // interface ignores it and the X3 accepts the order anyway.
    void header
    try {
      // The MAGLUMI X3 expects SNIBE's "simple" host-download framing (verified
      // on a live unit): <ENQ> <STX> <all records CR-separated> <ETX> <EOT> with
      // NO frame numbers and NO checksums. Standard E1381 frames (numbered +
      // checksummed) make the X3 read the SID but silently refuse the order.
      await sender.sendFrames(frameAstmSimple(buildAstmOrderRecords(sid, codes)))
      logger.info('host-query', `${def.name}: answered ${sid} with ${codes.length} test(s): [${codes.join(', ')}]`)
      this.pushMonitor({
        ...baseEvent,
        id: randomUUID(),
        stage: codes.length ? 'mapped' : 'skipped',
        value: codes.length ? codes.join(', ') : '(no tests)',
        mappedTo: codes.length ? codes.join(', ') : '(none)',
        message: codes.length
          ? `Ordered to analyzer: ${codes.join(', ')}`
          : 'Replied with empty order set'
      })
    } catch (err) {
      logger.error('host-query', `${def.name}: failed to send orders for ${sid}: ${(err as Error).message}`)
      this.pushMonitor({ ...baseEvent, id: randomUUID(), stage: 'error', message: (err as Error).message })
    }
  }

  /**
   * Answer a Beckman-AU sample-information request: look up the sample's ordered
   * tests in the LIS, map them to this analyzer's configured Online Test Numbers,
   * and transmit the S… response so the analyzer knows which assays to run.
   */
  private async handleAuHostQuery(
    def: InstrumentDefinition,
    driverId: string,
    req: { sid: string; rack: string; cup: string; sampleNo: string; raw: string }
  ): Promise<void> {
    const auSender = this.connections.get(def.id)?.auSender
    const baseEvent = {
      instrumentId: def.id,
      instrumentName: def.name,
      sampleId: req.sid,
      analyteCode: 'QUERY',
      analyteName: 'Sample-info request',
      value: '',
      raw: req.raw.length > 600 ? `${req.raw.slice(0, 600)}...` : req.raw,
      timestamp: new Date().toISOString()
    }
    this.pushMonitor({ ...baseEvent, id: randomUUID(), stage: 'received', message: `Order request for ${req.sid}` })

    let order: Awaited<ReturnType<ILisRepository['getOrder']>> = null
    try {
      order = await this.lis.getOrder(req.sid)
    } catch (err) {
      logger.warn('host-query', `${def.name}: AU order lookup failed for ${req.sid}: ${(err as Error).message}`)
    }

    // LIS test codes -> this analyzer's instrument codes -> 2-digit Online Test Nos.
    const codes = order
      ? this.mapping.instrumentCodesForLisTests(driverId, order.testCodes, order.testNames)
      : []
    const testNos = [...new Set(codes.map((c) => auOnlineTestNo(c)).filter((n): n is number => n != null))]

    if (testNos.length === 0) {
      // Replicate the live ElabAssistLite behaviour exactly: when nothing is
      // ordered/mappable, send NOTHING ("Order Not Found"). The AU re-requests a
      // few times then moves on — sending an empty S frame is never done.
      logger.info('host-query', `${def.name}: no Online Test Nos for ${req.sid} — sending nothing (matches eLab)`)
      this.pushMonitor({
        ...baseEvent,
        id: randomUUID(),
        stage: 'skipped',
        value: order ? `${order.testCodes.length} ordered, 0 on AU` : 'not registered',
        message: order
          ? `Ordered tests [${order.testCodes.join(', ')}] — none map to a configured AU Online Test No. (no order sent)`
          : `Barcode ${req.sid} not registered in LIS — nothing to order`
      })
      return
    }

    if (!auSender) return
    // Echo the request's identification fields verbatim (rack/cup/sampleNo/
    // sampleId) so they match exactly — the AU NAKs (alarm 6042 ONLINE MISMATCH)
    // if the response sample No./ID differ from what it asked for — then append
    // the fixed demographics block (E + M00000 + patient name) so the Online Test
    // Nos land at the offset the analyzer expects.
    const block = buildAuOrderResponse(req.raw, testNos, DEFAULT_AU_FORMAT, {
      patientName: order?.patientName
    })
    try {
      await auSender.send(block)
      logger.info(
        'host-query',
        `${def.name}: answered ${req.sid} with ${testNos.length} test(s): [${testNos.join(', ')}]`
      )
      this.pushMonitor({
        ...baseEvent,
        id: randomUUID(),
        stage: testNos.length ? 'mapped' : 'skipped',
        value: testNos.length ? `Online Test Nos: ${testNos.join(', ')}` : '(no tests)',
        mappedTo: codes.join(', ') || '(none)',
        message: testNos.length
          ? `Ordered ${testNos.length} test(s) to analyzer`
          : 'Replied with empty order set'
      })
    } catch (err) {
      logger.error('host-query', `${def.name}: failed to send AU orders for ${req.sid}: ${(err as Error).message}`)
      this.pushMonitor({ ...baseEvent, id: randomUUID(), stage: 'error', message: (err as Error).message })
    }
  }

  private async processResult(
    def: InstrumentDefinition,
    driverId: string,
    result: CanonicalResult,
    raw: string,
    // Tracks which SIDs have already been counted for the current message batch so
    // a multi-analyte sample counts as one result (its params still tally
    // separately via `resultParamsProcessed`).
    countedSids: Set<string>,
    options?: { forceWrite?: boolean }
  ): Promise<'written' | 'skipped' | 'suppressed' | 'error' | 'queued'> {
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

    // Count the result the moment it's received and decoded — independent of the
    // downstream LIS outcome (mapped/written/skipped/queued). A result that
    // arrives and parses is a received result even if it's unmapped or LIS
    // auto-write is off; the per-SID tally (resultsProcessed) and per-analyte
    // tally (resultParamsProcessed) should reflect everything the analyzer sent.
    this.countResult(def.id, result.sampleId, countedSids)

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

    // Variant channels (e.g. AU Glucose / RF): the mapping rule pins ONE LIS
    // variant, but the lab may have ordered a different one (Fasting vs PP vs
    // Random; RF Nephelometry vs IgM …). The analyzer reports a single value, so
    // fill whichever variant was actually ordered for this sample. Resolve it
    // from the order and retarget the write by code+name; drop the rule's fixed
    // testId so the repository matches the ordered variant's row (by testcode /
    // testname) instead of the pinned one. Falls back to the rule on any miss.
    let writeTestId = rule.lisTestId
    let writeTestCode = rule.lisTestCode ?? ''
    let writeTestName = rule.lisParamName ?? rule.lisTestName ?? ''
    const variant = auVariantGroup(result.analyteCode)
    if (variant && !rule.lisParamId && this.lis.mode === 'sql') {
      try {
        const order = await this.lis.getOrder(result.sampleId)
        const idx = order ? order.testNames.findIndex((n) => variant.matches(n)) : -1
        if (order && idx >= 0) {
          const orderedCode = (order.testCodes[idx] ?? '').trim()
          const orderedName = (order.testNames[idx] ?? '').trim()
          if (orderedName && orderedName.toUpperCase() !== writeTestName.toUpperCase()) {
            logger.info(
              'engine',
              `${def.name}: ${result.analyteCode} variant — filling ordered "${orderedName}" (${orderedCode}) instead of mapped "${writeTestName}"`
            )
          }
          if (orderedCode) writeTestCode = orderedCode
          if (orderedName) writeTestName = orderedName
          // Pinned testId belongs to the mapped variant, not the ordered one;
          // neutralize it (0 matches no row) so tier-1 can't fill the wrong
          // variant — the repository then matches by ordered testcode/testname.
          if (orderedCode && orderedCode.toUpperCase() !== (rule.lisTestCode ?? '').toUpperCase()) {
            writeTestId = 0
          }
        }
      } catch {
        // Order unavailable (LIS down) — keep the rule's fixed target.
      }
    }

    const write: LisResultWrite = {
      vailid: result.sampleId,
      testId: writeTestId,
      paramId: rule.lisParamId,
      testCode: writeTestCode,
      // Noble labels parameter rows by the parameter name; this is only used when
      // inserting a brand-new row. Existing rows keep their LIS label (the
      // repository UPDATE never touches testname/testcode/testunit).
      testName: writeTestName,
      value: writeValue,
      unit: writeUnit,
      abnormal: !!result.flag && result.flag !== 'N',
      // Value-only drivers (e.g. Agappe Mispa Maestro) send the value alone; the
      // repository then omits the abnormal column so the LIS keeps its own ranges.
      valueOnly: getDriver(driverId)?.lisValueOnly ?? false,
      machineName: def.name.slice(0, 20),
      uploadFlag: 'Y',
      addedDate: new Date().toISOString()
    }

    try {
      const outcome = await this.lis.writeResult(write)
      if (outcome === 'suppressed') {
        // Read-only safe mode: the value was resolved against live Noble data but
        // the write was deliberately blocked. Nothing is persisted.
        this.pushMonitor({
          ...base,
          id: randomUUID(),
          stage: 'suppressed',
          mappedTo,
          message: `Read-only mode — NOT written to Noble (would write ${write.value}${write.unit ? ` ${write.unit}` : ''})`
        })
        return 'suppressed'
      }
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

  /**
   * Tally a counted (written or imported) param. Each call bumps the per-param
   * counter; the sample (SID) counter bumps only the first time a SID is seen in
   * the current message batch, so one sample = one result regardless of how many
   * analytes it carried.
   */
  private countResult(id: string, sampleId: string, countedSids: Set<string>): void {
    const rt = this.runtimes.get(id)
    const newSid = !countedSids.has(sampleId)
    if (newSid) countedSids.add(sampleId)
    this.patchRuntime(id, {
      resultParamsProcessed: (rt?.resultParamsProcessed ?? 0) + 1,
      ...(newSid ? { resultsProcessed: (rt?.resultsProcessed ?? 0) + 1 } : {})
    })
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

  /** Surface raw bytes we transmit (host-query order frames, ACK/ENQ/EOT). */
  private pushRawSent(instrumentId: string, instrumentName: string, chunk: Buffer): void {
    const text = chunk.toString('latin1')
    const printable = text.replace(/[\x00-\x08\x0e-\x1f\x7f]/g, (c) => `<${c.charCodeAt(0)}>`)
    this.pushMonitor({
      id: randomUUID(),
      instrumentId,
      instrumentName,
      sampleId: '-',
      analyteCode: 'TX',
      analyteName: 'Raw outbound frame',
      value: `${chunk.length} bytes`,
      raw: printable.length > 600 ? `${printable.slice(0, 600)}...` : printable,
      stage: 'received',
      timestamp: new Date().toISOString()
    })
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
      resultParamsProcessed: saved?.resultParamsProcessed ?? 0,
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
      'resultParamsProcessed' in patch ||
      'lastMessageAt' in patch ||
      'errors' in patch
    ) {
      persist.setInstrumentStats(id, {
        messagesReceived: next.messagesReceived,
        resultsProcessed: next.resultsProcessed,
        resultParamsProcessed: next.resultParamsProcessed,
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

    let results: CanonicalResult[] = sample.analytes.map((a) => ({
      id: randomUUID(),
      instrumentId,
      sampleId: sample.barcode,
      analyteCode: a.code,
      value: a.value,
      unit: a.unit,
      flag: 'N' as const,
      receivedAt: now
    }))
    // Apply the SAME HbA1c/eAG derivation as the live pipeline so this backfill
    // posts the Synapse-CALCULATED eAG (mg/dL) — not the analyzer's own eAG —
    // keeping both write paths byte-for-byte consistent.
    const driver = getDriver(def.driverId)
    if (driver?.info.derivesEag) {
      results = applyHba1cDerivations(results, {
        autoEag: def.connection.autoEag !== false,
        instrumentId
      })
    }

    const countedSids = new Set<string>()
    for (const result of results) {
      if (!lisAnalytes.has(result.analyteCode)) continue
      const outcome = await this.processResult(def, def.driverId, result, normalized, countedSids, {
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
  // Hematology analyzers (e.g. EDAN H60) report HGB/MCHC in g/L while Noble's
  // CBC fields are g/dL — convert by /10 whenever the analyzer reports g/L and
  // the mapping's target unit is g/dL (so 144 g/L -> 14.4 g/dL).
  const srcUnit = (result.unit ?? '').replace(/\s+/g, '').toLowerCase()
  const tgtUnit = (rule.unit ?? '').replace(/\s+/g, '').toLowerCase()
  if (srcUnit === 'g/l' && tgtUnit === 'g/dl') {
    const n = parseFloat(result.value)
    if (!Number.isNaN(n)) return { value: (n / 10).toFixed(1), unit: 'g/dL' }
  }
  return { value: result.value, unit: result.unit ?? rule.unit }
}
