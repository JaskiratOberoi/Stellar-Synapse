import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/Card'
import { Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/layout/PageHeader'
import { useAppStore } from '@/store/useAppStore'
import { cn, formatTime } from '@/lib/utils'
import { fadeInUp, staggerContainer } from '@/lib/motion'

export function Logs() {
  const logs = useAppStore((s) => s.logs)
  const [level, setLevel] = useState('all')

  const sources = useMemo(() => Array.from(new Set(logs.map((l) => l.source))), [logs])
  const [source, setSource] = useState('all')

  const filtered = logs.filter((l) => {
    if (level !== 'all' && l.level !== level) return false
    if (source !== 'all' && l.source !== source) return false
    return true
  })

  return (
    <motion.div className="space-y-4" variants={staggerContainer} initial="hidden" animate="show">
      <motion.div variants={fadeInUp}>
        <PageHeader title="Logs" subtitle="System and protocol activity log">
          <Badge tone="muted">{filtered.length} entries</Badge>
          <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-36">
            <option value="all">All levels</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </Select>
          <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-44">
            <option value="all">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </PageHeader>
      </motion.div>

      <motion.div variants={fadeInUp}>
      <Card>
        <CardContent className="p-3">
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto font-mono text-xs">
            {/* Plain rows with a CSS entrance — a log line arrives per inbound
                chunk, so no framer-motion exit animation (see .row-enter). */}
            {filtered.map((l) => (
              <div
                key={l.id}
                className="row-enter flex items-start gap-3 rounded-2xl px-3 py-2 transition-colors hover:bg-secondary/60"
              >
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatTime(l.timestamp)}
                </span>
                <span
                  className={cn(
                    'w-12 shrink-0 font-medium uppercase',
                    l.level === 'error'
                      ? 'text-destructive'
                      : l.level === 'warn'
                        ? 'text-warning'
                        : l.level === 'info'
                          ? 'text-accent'
                          : 'text-muted-foreground'
                  )}
                >
                  {l.level}
                </span>
                <span className="w-28 shrink-0 text-muted-foreground">[{l.source}]</span>
                <span className="flex-1 text-foreground">{l.message}</span>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="py-10 text-center font-sans text-sm text-muted-foreground">
                No log entries.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      </motion.div>
    </motion.div>
  )
}
