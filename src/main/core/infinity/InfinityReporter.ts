import { EventEmitter } from 'node:events'
import { app, Notification } from 'electron'
import type {
  AppSettings,
  CloudSyncStatus,
  CloudTestResult,
  ConnectionStatus,
  InstrumentRuntime
} from '../../../shared/types'
import type { Orchestrator } from '../engine/Orchestrator'
import { persist } from '../../store'
import { logger } from '../logger'

/** Quiet window after an instrument change before a report is pushed. */
const DEBOUNCE_MS = 2000
/** Heartbeat cadence — a report goes out this often even with no changes. */
const HEARTBEAT_MS = 60_000
/** Abort an HTTP request to Infinity after this long. */
const FETCH_TIMEOUT_MS = 15_000
/** Failure backoff: first retry delay, doubling up to the max. */
const BACKOFF_MIN_MS = 30_000
const BACKOFF_MAX_MS = 5 * 60_000
/** How long 'connecting' may persist before the operator is alerted. */
const STUCK_CONNECTING_MS = 10 * 60_000
/** Cadence of the stuck-connecting check. */
const ALERT_CHECK_MS = 60_000

/** One per-local-date rollup entry in the report body. */
interface ReportDay {
  date: string
  samples: number
  results: number
  errors: number
}

/** One instrument snapshot in the report body (Infinity wire contract). */
interface ReportInstrument {
  key: string
  name: string
  driverId: string
  protocol: string
  transport: string
  address: string
  enabled: boolean
  status: ConnectionStatus
  statusSince: string | null
  lastMessageAt: string | null
  messagesReceived: number
  resultsProcessed: number
  resultParamsProcessed: number
  errors: number
  days: ReportDay[]
}

interface ReportBody {
  agentVersion: string
  reportedAt: string
  labName: string
  labLocation: string
  instruments: ReportInstrument[]
}

/**
 * Pushes instrument status + stats to the Stellar Infinity cloud platform over
 * HTTPS in near-realtime, and locally alerts the operator (OS notification) when
 * an instrument disconnects or is stuck connecting.
 *
 * Core rule inherited from the rest of the app: a cloud/network failure must
 * NEVER disturb instrument interfacing. Every timer callback and request is
 * fully caught; failures only log and back off (30 s doubling to 5 min).
 *
 * The alert watcher runs unconditionally — disconnect notifications work even
 * when cloud sync is disabled or unconfigured.
 *
 * Emits 'status' (CloudSyncStatus) on every state change for the Settings UI.
 */
export class InfinityReporter extends EventEmitter {
  private status: CloudSyncStatus = {
    configured: false,
    enabled: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null
  }
  private running = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private alertTimer: ReturnType<typeof setInterval> | null = null
  private pushing = false
  private backoffMs = 0
  private backoffUntil = 0
  /**
   * Day-change dedupe: `${instrumentId}|${date}` -> JSON of the last day entry
   * that reached Infinity. A day is re-sent only when its numbers changed; on
   * process start the map is empty so every retained day counts as changed.
   */
  private lastSentDays = new Map<string, string>()
  // Alert watcher state.
  private prevStatus = new Map<string, ConnectionStatus>()
  private alertedOutage = new Set<string>()
  private alertedStuck = new Set<string>()

  constructor(private readonly orchestrator: Orchestrator) {
    super()
    // Unconditional: local disconnect alerts must fire even with cloud sync off.
    this.orchestrator.on('instruments', (list: InstrumentRuntime[]) => {
      try {
        this.watchAlerts(list)
        if (this.running) this.schedulePush()
      } catch (err) {
        logger.warn('infinity', `Instrument watcher error: ${(err as Error).message}`)
      }
    })
  }

  /** Arm the alert watcher and apply the saved settings. Call once at startup. */
  start(): void {
    if (!this.alertTimer) {
      this.alertTimer = setInterval(() => {
        try {
          this.checkStuckConnecting()
        } catch (err) {
          logger.warn('infinity', `Stuck-connecting check error: ${(err as Error).message}`)
        }
      }, ALERT_CHECK_MS)
    }
    this.applySettings()
  }

  /** Re-read settings and start/stop cloud sync accordingly. */
  onSettingsChanged(): void {
    this.applySettings()
  }

  /** Current status snapshot (for the IPC get handler). */
  getStatus(): CloudSyncStatus {
    return { ...this.status }
  }

  /** Probe the Infinity ping endpoint with the given (possibly unsaved) creds. */
  async testConnection(baseUrl: string, siteCode: string, siteKey: string): Promise<CloudTestResult> {
    const base = normalizeBaseUrl(baseUrl)
    if (!base || !siteCode || !siteKey) {
      return { ok: false, error: 'Base URL, site code and site key are all required' }
    }
    try {
      const res = await this.fetchWithTimeout(`${base}/api/interfacing/ping`, {
        headers: { 'X-Site-Code': siteCode, 'X-Site-Key': siteKey }
      })
      if (res.status === 401) return { ok: false, error: 'Invalid site code or key' }
      if (!res.ok) return { ok: false, error: `Infinity responded with HTTP ${res.status}` }
      const body = (await res.json()) as { ok?: boolean; site?: { name?: string } }
      if (!body.ok) return { ok: false, error: 'Unexpected response from Infinity' }
      return { ok: true, siteName: body.site?.name }
    } catch (err) {
      return { ok: false, error: describeFetchError(err) }
    }
  }

  // ----- cloud sync lifecycle ------------------------------------------------

  private applySettings(): void {
    const s = persist.getSettings()
    const configured =
      !!normalizeBaseUrl(s.infinityBaseUrl) && !!s.infinitySiteCode && !!s.infinitySiteKey
    const shouldRun = s.infinityEnabled && configured

    // Restart cleanly on any settings change so a new URL/key takes effect and a
    // fresh start re-sends every retained day (empty dedupe map).
    if (this.running) this.stopSync()
    if (shouldRun) {
      this.running = true
      this.backoffMs = 0
      this.backoffUntil = 0
      this.lastSentDays.clear()
      this.heartbeatTimer = setInterval(() => {
        if (Date.now() >= this.backoffUntil) void this.push()
      }, HEARTBEAT_MS)
      this.schedulePush()
      logger.info('infinity', `Cloud sync armed (${normalizeBaseUrl(s.infinityBaseUrl)})`)
    }

    this.patchStatus({ configured, enabled: s.infinityEnabled })
  }

  private stopSync(): void {
    this.running = false
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  /** Debounced push, 2 s after the last instrument change. Suppressed in backoff. */
  private schedulePush(): void {
    if (!this.running || Date.now() < this.backoffUntil) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => void this.push(), DEBOUNCE_MS)
  }

  private async push(): Promise<void> {
    if (!this.running || this.pushing || Date.now() < this.backoffUntil) return
    this.pushing = true
    try {
      const s = persist.getSettings()
      const base = normalizeBaseUrl(s.infinityBaseUrl)
      if (!base || !s.infinitySiteCode || !s.infinitySiteKey) return
      const { body, sentDays } = this.buildReport(s)
      this.patchStatus({ lastAttemptAt: new Date().toISOString() })
      const res = await this.fetchWithTimeout(`${base}/api/interfacing/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Site-Code': s.infinitySiteCode,
          'X-Site-Key': s.infinitySiteKey
        },
        body: JSON.stringify(body)
      })
      if (res.status === 401) throw new Error('Invalid site code or key')
      if (!res.ok) throw new Error(`Infinity responded with HTTP ${res.status}`)
      // Only mark days as delivered once Infinity acknowledged the report.
      for (const [key, json] of sentDays) this.lastSentDays.set(key, json)
      this.backoffMs = 0
      this.backoffUntil = 0
      this.patchStatus({ lastSuccessAt: new Date().toISOString(), lastError: null })
    } catch (err) {
      const message = describeFetchError(err)
      this.backoffMs = this.backoffMs
        ? Math.min(this.backoffMs * 2, BACKOFF_MAX_MS)
        : BACKOFF_MIN_MS
      this.backoffUntil = Date.now() + this.backoffMs
      this.patchStatus({ lastError: message })
      logger.warn(
        'infinity',
        `Cloud push failed (retrying in ${Math.round(this.backoffMs / 1000)}s): ${message}`
      )
    } finally {
      this.pushing = false
    }
  }

  private buildReport(s: AppSettings): {
    body: ReportBody
    sentDays: [string, string][]
  } {
    const daily = this.orchestrator.getDailyStats()
    const dates = Object.keys(daily).sort()
    const sentDays: [string, string][] = []

    const instruments = this.orchestrator.listInstruments().map((rt): ReportInstrument => {
      const days: ReportDay[] = []
      for (const date of dates) {
        const stats = daily[date]?.[rt.id]
        if (!stats) continue
        const entry: ReportDay = {
          date,
          samples: stats.samples,
          results: stats.results,
          errors: stats.errors
        }
        const key = `${rt.id}|${date}`
        const json = JSON.stringify(entry)
        // Include a day only when its numbers changed since the last successful
        // push (everything counts as changed right after process/service start).
        if (this.lastSentDays.get(key) === json) continue
        days.push(entry)
        sentDays.push([key, json])
      }
      return {
        key: rt.id,
        name: rt.name,
        driverId: rt.driverId,
        protocol: rt.protocol,
        transport: rt.connection.transport,
        address: instrumentAddress(rt),
        enabled: rt.enabled,
        status: rt.status,
        statusSince: rt.statusSince ?? null,
        lastMessageAt: rt.lastMessageAt ?? null,
        messagesReceived: rt.messagesReceived,
        resultsProcessed: rt.resultsProcessed,
        resultParamsProcessed: rt.resultParamsProcessed,
        errors: rt.errors,
        days
      }
    })

    return {
      body: {
        agentVersion: app.getVersion(),
        reportedAt: new Date().toISOString(),
        labName: s.labName,
        labLocation: s.labLocation,
        instruments
      },
      sentDays
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  // ----- local disconnect / stuck-connecting alerts --------------------------

  private watchAlerts(list: InstrumentRuntime[]): void {
    for (const rt of list) {
      const prev = this.prevStatus.get(rt.id)
      this.prevStatus.set(rt.id, rt.status)
      if (!rt.enabled) continue

      if (rt.status === 'online') {
        // Recovery: only announce it when an alert went out for this outage.
        if (this.alertedOutage.has(rt.id) || this.alertedStuck.has(rt.id)) {
          this.alertedOutage.delete(rt.id)
          this.alertedStuck.delete(rt.id)
          this.notify(`${rt.name} reconnected`, 'The instrument link is back online.')
        }
        continue
      }

      if (prev === 'online' && (rt.status === 'offline' || rt.status === 'error')) {
        if (!this.alertedOutage.has(rt.id)) {
          this.alertedOutage.add(rt.id)
          this.notify(
            `${rt.name} disconnected`,
            'The instrument link dropped. Results will not arrive until it reconnects.'
          )
        }
      }

      // Leaving 'connecting' for anything other than 'online' ends the stuck
      // stretch, so a later stretch can alert again.
      if (rt.status !== 'connecting') this.alertedStuck.delete(rt.id)
    }
  }

  private checkStuckConnecting(): void {
    for (const rt of this.orchestrator.listInstruments()) {
      if (!rt.enabled || rt.status !== 'connecting' || !rt.statusSince) continue
      if (this.alertedStuck.has(rt.id)) continue
      if (Date.now() - Date.parse(rt.statusSince) > STUCK_CONNECTING_MS) {
        this.alertedStuck.add(rt.id)
        this.notify(
          `${rt.name} is stuck connecting`,
          'The instrument has been trying to connect for over 10 minutes. Check the analyzer and the cable/network.'
        )
      }
    }
  }

  private notify(title: string, body: string): void {
    logger.warn('alert', `${title} — ${body}`)
    try {
      if (Notification.isSupported()) new Notification({ title, body }).show()
    } catch (err) {
      logger.warn('alert', `Could not show notification: ${(err as Error).message}`)
    }
  }

  private patchStatus(next: Partial<CloudSyncStatus>): void {
    const merged = { ...this.status, ...next }
    const changed = (Object.keys(merged) as (keyof CloudSyncStatus)[]).some(
      (k) => merged[k] !== this.status[k]
    )
    if (!changed) return
    this.status = merged
    this.emit('status', this.getStatus())
  }
}

/** Trimmed base URL without a trailing slash; empty string when unset. */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Human-readable address for the report: host:port, listen :port, or COM path. */
function instrumentAddress(rt: InstrumentRuntime): string {
  const c = rt.connection
  if (c.transport === 'tcp-client') return `${c.host ?? ''}:${c.port ?? ''}`
  if (c.transport === 'tcp-server') return `listen :${c.port ?? ''}`
  return c.serialPath ?? ''
}

/** Failure message for the UI/log; abort (timeout) gets a clear label. */
function describeFetchError(err: unknown): string {
  const e = err as Error & { cause?: { message?: string } }
  if (e?.name === 'AbortError') return `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`
  return e?.cause?.message ? `${e.message}: ${e.cause.message}` : (e?.message ?? String(err))
}
