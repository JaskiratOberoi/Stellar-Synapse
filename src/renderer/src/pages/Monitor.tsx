import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Pause, Play, Code2, List } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import { useAppStore } from '@/store/useAppStore'
import { cn, formatTime } from '@/lib/utils'
import { ease, spring } from '@/lib/motion'
import type { MonitorEvent, MonitorStage } from '@shared/types'

const stageTone: Record<MonitorStage, 'muted' | 'accent' | 'primary' | 'success' | 'warning' | 'danger'> = {
  received: 'muted',
  decoded: 'accent',
  mapped: 'primary',
  written: 'success',
  skipped: 'warning',
  queued: 'accent',
  error: 'danger'
}

export function Monitor() {
  const monitor = useAppStore((s) => s.monitor)
  const instruments = useAppStore((s) => s.instruments)
  const [paused, setPaused] = useState(false)
  const [frozen, setFrozen] = useState<MonitorEvent[]>([])
  const [stage, setStage] = useState('all')
  const [inst, setInst] = useState('all')
  const [view, setView] = useState<'parsed' | 'raw'>('parsed')
  const [selected, setSelected] = useState<MonitorEvent | null>(null)

  const source = paused ? frozen : monitor

  const filtered = useMemo(
    () =>
      source.filter((m) => {
        if (stage !== 'all' && m.stage !== stage) return false
        if (inst !== 'all' && m.instrumentId !== inst) return false
        return true
      }),
    [source, stage, inst]
  )

  const togglePause = (): void => {
    if (!paused) setFrozen(monitor)
    setPaused(!paused)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Button variant={paused ? 'success' : 'outline'} size="sm" onClick={togglePause}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Select value={inst} onChange={(e) => setInst(e.target.value)} className="w-52">
            <option value="all">All instruments</option>
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
          <Select value={stage} onChange={(e) => setStage(e.target.value)} className="w-40">
            <option value="all">All stages</option>
            <option value="decoded">Decoded</option>
            <option value="mapped">Mapped</option>
            <option value="written">Written</option>
            <option value="skipped">Skipped</option>
            <option value="error">Error</option>
          </Select>
          <div className="ml-auto flex rounded-lg border border-border p-0.5">
            <button
              onClick={() => setView('parsed')}
              className={cn(
                'relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                view === 'parsed' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {view === 'parsed' && (
                <motion.span
                  layoutId="monitor-view"
                  transition={spring}
                  className="absolute inset-0 rounded-md bg-secondary"
                />
              )}
              <List className="relative z-10 h-3.5 w-3.5" /> <span className="relative z-10">Parsed</span>
            </button>
            <button
              onClick={() => setView('raw')}
              className={cn(
                'relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                view === 'raw' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {view === 'raw' && (
                <motion.span
                  layoutId="monitor-view"
                  transition={spring}
                  className="absolute inset-0 rounded-md bg-secondary"
                />
              )}
              <Code2 className="relative z-10 h-3.5 w-3.5" /> <span className="relative z-10">Raw</span>
            </button>
          </div>
          <Badge tone={paused ? 'warning' : 'success'}>
            {paused ? 'Paused' : 'Live'} — {filtered.length} shown ({monitor.length} retained)
          </Badge>
        </CardContent>
      </Card>

      <div className={cn('grid gap-4', selected ? 'lg:grid-cols-3' : 'grid-cols-1')}>
        <Card className={selected ? 'lg:col-span-2' : ''}>
          <CardContent className="p-0">
            <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card/95 backdrop-blur">
                  <tr className="border-b border-border/60 text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Time</th>
                    <th className="px-4 py-2.5 font-medium">Stage</th>
                    <th className="px-4 py-2.5 font-medium">Sample</th>
                    <th className="px-4 py-2.5 font-medium">Analyte</th>
                    <th className="px-4 py-2.5 font-medium">Value</th>
                    {view === 'parsed' && <th className="px-4 py-2.5 font-medium">LIS Target</th>}
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                  {filtered.map((m) => (
                    <motion.tr
                      key={m.id}
                      initial={{ opacity: 0, backgroundColor: 'hsl(var(--primary) / 0.12)' }}
                      animate={{ opacity: 1, backgroundColor: 'hsl(var(--primary) / 0)' }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                      onClick={() => setSelected(m)}
                      className={cn(
                        'cursor-pointer border-b border-border/30 hover:bg-secondary/40',
                        selected?.id === m.id && 'bg-secondary/50'
                      )}
                    >
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {formatTime(m.timestamp)}
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={stageTone[m.stage]}>{m.stage}</Badge>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-accent">{m.sampleId}</td>
                      <td className="px-4 py-2 font-medium">
                        {m.analyteCode}
                        {m.flag && m.flag !== 'N' && (
                          <span className="ml-1 text-xs font-bold text-destructive">{m.flag}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span className="font-semibold">{m.value}</span>{' '}
                        <span className="text-xs text-muted-foreground">{m.unit}</span>
                      </td>
                      {view === 'parsed' && (
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {m.mappedTo ?? m.message ?? '-'}
                        </td>
                      )}
                    </motion.tr>
                  ))}
                  </AnimatePresence>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-16 text-center text-sm text-muted-foreground">
                        Waiting for instrument data...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <AnimatePresence>
        {selected && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={ease}
          >
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Message Detail</h3>
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  Close
                </Button>
              </div>
              <Detail label="Instrument" value={selected.instrumentName} />
              <Detail label="Sample ID" value={selected.sampleId} mono />
              <Detail label="Analyte" value={`${selected.analyteCode} ${selected.analyteName ?? ''}`} />
              <Detail label="Value" value={`${selected.value} ${selected.unit ?? ''}`} />
              <Detail label="Flag" value={selected.flag ?? 'N'} />
              <Detail label="Stage" value={selected.stage} />
              <Detail label="LIS Target" value={selected.mappedTo ?? '-'} />
              {selected.message && <Detail label="Message" value={selected.message} />}
              <div>
                <p className="mb-1 text-xs uppercase text-muted-foreground">Raw Frame</p>
                <pre className="max-h-64 overflow-auto rounded-lg bg-background/80 p-3 font-mono text-[11px] leading-relaxed text-accent">
                  {selected.raw ?? 'n/a'}
                </pre>
              </div>
            </CardContent>
          </Card>
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 pb-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-medium', mono && 'font-mono text-accent')}>{value}</span>
    </div>
  )
}
