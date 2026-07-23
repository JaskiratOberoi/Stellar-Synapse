import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Play, Square, Cpu, Beaker, List, Code2, FileInput, Eraser, Pencil } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { StatusDot } from '@/components/ui/StatusDot'
import { Switch } from '@/components/ui/Switch'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { EditInstrumentModal } from '@/components/EditInstrumentModal'
import { useAppStore } from '@/store/useAppStore'
import { cn, formatTime, timeAgo } from '@/lib/utils'
import { fadeInUp, listItem, spring, staggerContainer } from '@/lib/motion'
import {
  normalizeLd560Raw,
  parseLd560SampleFromRaw,
  ld560FrameLisStatus,
  eagMgDlFromHba1c,
  mgDlToMmolL
} from '@shared/ld560Transmit'

/**
 * Build the LD-560 result rows: the analyzer's analytes (its own eAG relabelled
 * "eAG (Instrument)"), plus a derived "eAG (Calculated)" row from HbA1c shown in
 * BOTH mg/dL (the value posted to the LIS) and mmol/L (directly comparable to the
 * instrument's own eAG).
 */
function buildLd560Rows(
  ld: string,
  analytes: { code: string; value: string; unit: string }[]
): { id: string; analyteCode: string; analyteName?: string; value: string; unit?: string }[] {
  const rows = analytes.map((a) => ({
    id: `${ld}-${a.code}`,
    analyteCode: a.code === 'eAG' ? 'eAG (Instrument)' : a.code,
    value: a.value,
    unit: a.unit
  }))
  const hba1c = analytes.find((a) => a.code === 'HbA1c')
  const mgdl = hba1c ? eagMgDlFromHba1c(parseFloat(hba1c.value)) : null
  if (mgdl !== null) {
    rows.push({
      id: `${ld}-eAG-calc`,
      analyteCode: 'eAG (Calculated)',
      value: mgdl.toFixed(1),
      unit: `mg/dL · ${mgDlToMmolL(mgdl).toFixed(1)} mmol/L`
    })
  }
  return rows
}

export function InstrumentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const inst = useAppStore((s) => s.instruments.find((i) => i.id === id))
  const drivers = useAppStore((s) => s.drivers)
  const monitor = useAppStore((s) => s.monitor.filter((m) => m.instrumentId === id))
  const lisLive = useAppStore((s) => s.lisSettings?.live)
  const [editing, setEditing] = useState(false)
  const [logView, setLogView] = useState<'parsed' | 'raw'>('parsed')
  const [parsingRaw, setParsingRaw] = useState<string | null>(null)
  const [parsingAll, setParsingAll] = useState(false)
  const [writeFeedback, setWriteFeedback] = useState<string | null>(null)

  // Build the decoded-results view. Two sources:
  //  - LD-560 <TRANSMIT> raw frames (reconstructed from raw so they survive parser
  //    fixes and can be re-parsed to the LIS), and
  //  - generic decoded results for every other protocol (ASTM/HL7/Simple), grouped
  //    by their raw frame from the 'decoded' monitor events.
  const resultFrames = useMemo(() => {
    type Frame = {
      sampleId: string
      internalSeq?: string
      timestamp: string
      raw: string
      kind: 'ld560' | 'generic'
      rows: { id: string; analyteCode: string; analyteName?: string; value: string; unit?: string }[]
      lisStatus: ReturnType<typeof ld560FrameLisStatus> | undefined
    }
    const byKey = new Map<string, Frame>()

    for (const m of monitor) {
      // 1) LD-560 reconstruction from the raw TRANSMIT frame.
      const ld = normalizeLd560Raw(m.raw)
      if (ld) {
        if (byKey.has(ld)) continue
        const parsed = parseLd560SampleFromRaw(ld)
        if (parsed) {
          byKey.set(ld, {
            sampleId: parsed.barcode,
            internalSeq: parsed.internalSeq,
            timestamp: m.timestamp,
            raw: ld,
            kind: 'ld560',
            lisStatus: ld560FrameLisStatus(monitor, id ?? '', ld),
            rows: buildLd560Rows(ld, parsed.analytes)
          })
          continue
        }
      }
      // 2) Generic decoded analyte result (ASTM/HL7/Simple) — group by frame.
      if (
        m.stage === 'decoded' &&
        m.analyteCode &&
        m.analyteCode !== 'RAW' &&
        m.analyteCode !== 'QUERY'
      ) {
        const key = `gen:${m.raw || `${m.sampleId}-${m.timestamp}`}`
        const existing = byKey.get(key)
        if (existing) {
          if (!existing.rows.some((r) => r.analyteCode === m.analyteCode)) {
            existing.rows.push({
              id: m.id,
              analyteCode: m.analyteCode,
              analyteName: m.analyteName,
              value: m.value,
              unit: m.unit
            })
          }
        } else {
          byKey.set(key, {
            sampleId: m.sampleId,
            timestamp: m.timestamp,
            raw: m.raw ?? '',
            kind: 'generic',
            lisStatus: undefined,
            rows: [
              {
                id: m.id,
                analyteCode: m.analyteCode,
                analyteName: m.analyteName,
                value: m.value,
                unit: m.unit
              }
            ]
          })
        }
      }
    }

    // Derive LIS status for generic frames from their analytes' 'written' events.
    for (const f of byKey.values()) {
      if (f.kind !== 'generic') continue
      const written = new Set(
        monitor.filter((m) => m.stage === 'written' && m.sampleId === f.sampleId).map((m) => m.analyteCode)
      )
      if (written.size > 0) {
        f.lisStatus = f.rows.every((r) => written.has(r.analyteCode)) ? 'done' : 'partial'
      }
    }

    return [...byKey.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }, [monitor, id])

  const unparsedCount = useMemo(
    () => resultFrames.filter((f) => f.kind === 'ld560' && f.lisStatus !== 'done').length,
    [resultFrames]
  )

  const activityLog = useMemo(
    () => monitor.filter((m) => m.stage !== 'received' || m.analyteCode !== 'RAW'),
    [monitor]
  )

  // Distinct raw protocol frames (each message produces one frame shared across
  // its analyte events), newest first, for the realtime raw data view.
  const rawFrames = useMemo(() => {
    const seen = new Set<string>()
    const frames: { id: string; raw: string; timestamp: string; sampleId: string }[] = []
    for (const m of monitor) {
      if (!m.raw || seen.has(m.raw)) continue
      seen.add(m.raw)
      frames.push({ id: m.id, raw: m.raw, timestamp: m.timestamp, sampleId: m.sampleId })
    }
    return frames
  }, [monitor])

  if (!inst) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <p className="text-muted-foreground">Instrument not found.</p>
        <Button variant="outline" onClick={() => navigate('/instruments')}>
          Back to Instruments
        </Button>
      </div>
    )
  }

  const driver = drivers.find((d) => d.id === inst.driverId)
  const running = inst.status === 'online' || inst.status === 'listening'

  const setHostQuery = async (v: boolean): Promise<void> => {
    await window.api.instruments.update(inst.id, {
      connection: { ...inst.connection, hostQuery: v }
    })
  }

  const setAutoEag = async (v: boolean): Promise<void> => {
    await window.api.instruments.update(inst.id, {
      connection: { ...inst.connection, autoEag: v }
    })
  }

  const emitSample = async (): Promise<void> => {
    await window.api.simulator.emitOne(inst.id)
  }

  const parseFrameToLis = async (raw: string, sampleId: string): Promise<void> => {
    setParsingRaw(raw)
    setWriteFeedback(null)
    try {
      const result =
        typeof window.api.lis.parseFrame === 'function'
          ? await window.api.lis.parseFrame(inst.id, raw)
          : {
              ...(await window.api.lis.writeBarcode(inst.id, sampleId)),
              barcode: sampleId
            }
      setWriteFeedback(
        `LIS parsed ${sampleId}: ${result.written} written` +
          (result.skipped ? `, ${result.skipped} skipped` : '') +
          (result.errors ? `, ${result.errors} failed` : '')
      )
    } catch (err) {
      setWriteFeedback((err as Error).message)
    } finally {
      setParsingRaw(null)
    }
  }

  const parseAllToLis = async (): Promise<void> => {
    setParsingAll(true)
    setWriteFeedback(null)
    try {
      if (typeof window.api.lis.parseAllUnwritten !== 'function') {
        let written = 0
        let skipped = 0
        let errors = 0
        for (const frame of resultFrames.filter((f) => f.kind === 'ld560' && f.lisStatus !== 'done')) {
          try {
            const r = await window.api.lis.writeBarcode(inst.id, frame.sampleId)
            written += r.written
            skipped += r.skipped
            errors += r.errors
          } catch {
            errors++
          }
        }
        setWriteFeedback(
          `Parsed ${unparsedCount} sample(s): ${written} written` +
            (skipped ? `, ${skipped} skipped` : '') +
            (errors ? `, ${errors} failed` : '')
        )
        return
      }
      const result = await window.api.lis.parseAllUnwritten(inst.id)
      setWriteFeedback(
        `Parsed ${result.frames} sample(s): ${result.written} written` +
          (result.skipped ? `, ${result.skipped} skipped` : '') +
          (result.errors ? `, ${result.errors} failed` : '')
      )
    } catch (err) {
      setWriteFeedback((err as Error).message)
    } finally {
      setParsingAll(false)
    }
  }

  return (
    <motion.div className="space-y-6" variants={staggerContainer} initial="hidden" animate="show">
      <motion.div className="flex items-center justify-between" variants={fadeInUp}>
        <Button variant="ghost" size="sm" onClick={() => navigate('/instruments')}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" /> Edit Config
          </Button>
          <Button variant="outline" size="sm" onClick={emitSample} disabled={!running}>
            <Beaker className="h-4 w-4" /> Emit Test Sample
          </Button>
          <Button
            variant={running ? 'outline' : 'success'}
            size="sm"
            onClick={() => (running ? window.api.instruments.stop(inst.id) : window.api.instruments.start(inst.id))}
          >
            {running ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {running ? 'Stop' : 'Start'}
          </Button>
        </div>
      </motion.div>

      <motion.div className="flex items-center gap-4" variants={fadeInUp}>
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-accent/10 text-primary">
          <Cpu className="h-7 w-7" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-semibold">{inst.name}</h2>
          <p className="text-sm text-muted-foreground">{driver?.name} - {driver?.vendor}</p>
        </div>
        <StatusDot status={inst.status} />
      </motion.div>

      <motion.div className="grid gap-6 lg:grid-cols-3" variants={staggerContainer}>
        <motion.div variants={fadeInUp}>
        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Transport" value={inst.connection.transport} />
            <Row
              label={inst.connection.transport === 'serial' ? 'COM Port' : 'Address'}
              value={
                inst.connection.transport === 'serial'
                  ? `${inst.connection.serialPath} @ ${inst.connection.baudRate ?? 9600}`
                  : `${inst.connection.host}:${inst.connection.port}`
              }
            />
            <Row label="Protocol" value={inst.protocol.toUpperCase()} />
            <Row label="Peer" value={inst.peer ?? '-'} />
            <Row label="Last message" value={timeAgo(inst.lastMessageAt)} />
          </CardContent>
        </Card>
        </motion.div>

        <motion.div variants={fadeInUp}>
        <Card>
          <CardHeader>
            <CardTitle>Protocol Options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Host Query</p>
                <p className="text-xs text-muted-foreground">Query LIS by barcode</p>
              </div>
              <Switch
                checked={!!inst.connection.hostQuery}
                onChange={setHostQuery}
                disabled={driver?.mode === 'unidirectional'}
              />
            </div>
            {driver?.derivesEag && (
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Auto-calculate eAG</p>
                  <p className="text-xs text-muted-foreground">
                    Estimated Average Glucose from HbA1c → LIS
                  </p>
                </div>
                <Switch checked={inst.connection.autoEag !== false} onChange={setAutoEag} />
              </div>
            )}
            <div className="rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
              <p className="text-xs uppercase text-muted-foreground">Driver mode</p>
              <p className="mt-1 text-sm font-medium capitalize">{driver?.mode}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
              <p className="text-xs uppercase text-muted-foreground">Maturity</p>
              <Badge tone={driver?.maturity === 'stable' ? 'success' : driver?.maturity === 'beta' ? 'warning' : 'muted'}>
                {driver?.maturity}
              </Badge>
            </div>
          </CardContent>
        </Card>
        </motion.div>

        <motion.div variants={fadeInUp}>
        <Card>
          <CardHeader>
            <CardTitle>Counters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Counter label="Messages received" value={inst.messagesReceived} tone="text-foreground" />
            <Counter label="Results processed" value={inst.resultsProcessed} tone="text-success" />
            <Counter label="Result param count" value={inst.resultParamsProcessed} tone="text-success" />
            <Counter
              label="Errors"
              value={inst.errors}
              tone={inst.errors ? 'text-destructive' : 'text-foreground'}
              onClear={() => window.api.instruments.clearErrors(inst.id)}
            />
          </CardContent>
        </Card>
        </motion.div>
      </motion.div>

      <motion.div variants={fadeInUp}>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Received Results</CardTitle>
          <div className="flex items-center gap-2">
            {writeFeedback && (
              <span className="max-w-xs truncate text-xs text-muted-foreground">{writeFeedback}</span>
            )}
            {lisLive && unparsedCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={parsingAll}
                onClick={parseAllToLis}
              >
                <FileInput className="h-3 w-3" />
                {parsingAll ? 'Parsing…' : `LIS Parse all (${unparsedCount})`}
              </Button>
            )}
            <Badge tone="muted">{resultFrames.length} sample{resultFrames.length === 1 ? '' : 's'}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {resultFrames.map((frame) => (
              <div
                key={frame.raw ?? `${frame.sampleId}-${frame.timestamp}`}
                className="rounded-lg border border-border/50 bg-background/70"
              >
                <div className="flex items-center justify-between border-b border-border/40 px-3 py-2 text-xs">
                  <span>
                    <span className="font-mono font-medium text-accent">{frame.sampleId}</span>
                    {frame.internalSeq && (
                      <span className="ml-2 text-muted-foreground">run #{frame.internalSeq}</span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {frame.lisStatus === 'done' && (
                      <Badge tone="success">In LIS</Badge>
                    )}
                    {frame.lisStatus === 'partial' && (
                      <Badge tone="warning">Partial</Badge>
                    )}
                    {lisLive && frame.kind === 'ld560' && frame.lisStatus !== 'done' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={parsingRaw === frame.raw}
                        onClick={() => parseFrameToLis(frame.raw, frame.sampleId)}
                      >
                        <FileInput className="h-3 w-3" />
                        {parsingRaw === frame.raw ? 'Parsing…' : 'LIS Parse'}
                      </Button>
                    )}
                    <span className="text-muted-foreground">{formatTime(frame.timestamp)}</span>
                  </div>
                </div>
                <div className="divide-y divide-border/30 px-3 py-1">
                  {frame.rows.map((r) => (
                    <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="font-medium">
                        {r.analyteName || r.analyteCode}
                        {r.analyteName && r.analyteName !== r.analyteCode && (
                          <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">
                            {r.analyteCode}
                          </span>
                        )}
                      </span>
                      <span>
                        <span className="font-semibold">{r.value}</span>
                        {r.unit && <span className="ml-1 text-xs text-muted-foreground">{r.unit}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {resultFrames.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No decoded results yet. Results are retained across restarts once received.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Activity Log</CardTitle>
          <div className="flex items-center gap-2">
            <Badge tone="muted">{activityLog.length} events</Badge>
            <Badge tone={running ? 'success' : 'muted'}>{running ? 'Live' : 'Stopped'}</Badge>
            <div className="flex rounded-lg border border-border p-0.5">
              <button
                onClick={() => setLogView('parsed')}
                className={cn(
                  'relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  logView === 'parsed' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {logView === 'parsed' && (
                  <motion.span layoutId="detail-logview" transition={spring} className="absolute inset-0 rounded-md bg-secondary" />
                )}
                <List className="relative z-10 h-3.5 w-3.5" /> <span className="relative z-10">Parsed</span>
              </button>
              <button
                onClick={() => setLogView('raw')}
                className={cn(
                  'relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  logView === 'raw' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {logView === 'raw' && (
                  <motion.span layoutId="detail-logview" transition={spring} className="absolute inset-0 rounded-md bg-secondary" />
                )}
                <Code2 className="relative z-10 h-3.5 w-3.5" /> <span className="relative z-10">Raw</span>
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {logView === 'parsed' ? (
            <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
              <AnimatePresence initial={false}>
              {activityLog.map((m) => (
                <motion.div
                  key={m.id}
                  layout
                  variants={listItem}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  className="flex gap-3 rounded px-2 py-1 hover:bg-secondary/40"
                >
                  <span className="text-muted-foreground">{formatTime(m.timestamp)}</span>
                  <span
                    className={cn(
                      'w-16 shrink-0 uppercase',
                      m.stage === 'written' ? 'text-success' : m.stage === 'error' ? 'text-destructive' : m.stage === 'skipped' ? 'text-warning' : 'text-accent'
                    )}
                  >
                    {m.stage}
                  </span>
                  <span className="text-accent">{m.sampleId}</span>
                  <span className="flex-1 text-foreground">
                    {m.analyteName || m.analyteCode}={m.value} {m.unit}
                  </span>
                </motion.div>
              ))}
              </AnimatePresence>
              {activityLog.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
              )}
            </div>
          ) : (
            <div className="max-h-[28rem] space-y-3 overflow-y-auto">
              {rawFrames.map((f) => (
                <div key={f.id} className="rounded-lg border border-border/50 bg-background/70">
                  <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5 text-xs">
                    <span className="font-mono text-accent">{f.sampleId}</span>
                    <span className="text-muted-foreground">{formatTime(f.timestamp)}</span>
                  </div>
                  <pre className="overflow-x-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-all">
                    {f.raw}
                  </pre>
                </div>
              ))}
              {rawFrames.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No raw frames received yet.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      </motion.div>

      <EditInstrumentModal open={editing} onClose={() => setEditing(false)} instrument={inst} />
    </motion.div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function Counter({
  label,
  value,
  tone,
  onClear
}: {
  label: string
  value: number
  tone: string
  /** When provided, renders a "Clear" button that resets this counter. */
  onClear?: () => void
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-secondary/30 px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        {onClear && value > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={onClear}
            title="Reset this counter to zero"
          >
            <Eraser className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
        <span className={cn('text-2xl font-bold', tone)}>
          <AnimatedNumber value={value} />
        </span>
      </div>
    </div>
  )
}
