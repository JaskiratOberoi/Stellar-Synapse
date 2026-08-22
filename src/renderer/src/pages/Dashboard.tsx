import { useNavigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts'
import { AnimatePresence, motion } from 'framer-motion'
import { CircleCheck, TriangleAlert, ArrowUpRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { StatusDot } from '@/components/ui/StatusDot'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { PageHeader } from '@/components/layout/PageHeader'
import { useAppStore } from '@/store/useAppStore'
import { cn, formatTime } from '@/lib/utils'
import { fadeInUp, listItem, staggerContainer } from '@/lib/motion'
import type { MonitorStage } from '@shared/types'

const stageTone: Record<MonitorStage, string> = {
  received: 'text-muted-foreground',
  decoded: 'text-foreground/80',
  mapped: 'text-accent',
  written: 'text-success',
  skipped: 'text-warning',
  suppressed: 'text-warning',
  queued: 'text-accent',
  error: 'text-destructive'
}

export function Dashboard() {
  const stats = useAppStore((s) => s.stats)
  const instruments = useAppStore((s) => s.instruments)
  const monitor = useAppStore((s) => s.monitor)
  const navigate = useNavigate()

  const online = stats?.instrumentsOnline ?? 0
  const total = stats?.instrumentsTotal ?? 0
  const perHour = stats?.resultsPerHour ?? []
  const hourlyAvg =
    perHour.length > 0 ? perHour.reduce((sum, h) => sum + h.count, 0) / perHour.length : 0
  const attention = instruments.filter(
    (i) => i.enabled && (i.status === 'error' || i.status === 'offline' || i.status === 'connecting')
  ).length

  return (
    <motion.div className="space-y-5" variants={staggerContainer} initial="hidden" animate="show">
      <motion.div variants={fadeInUp}>
        <PageHeader title="Dashboard" subtitle="Live overview of instruments and result throughput" />
      </motion.div>

      {/* Instrument rail — every analyzer as a pill, status first. */}
      {instruments.length > 0 && (
        <motion.div className="flex flex-wrap gap-2" variants={fadeInUp}>
          {instruments.map((inst) => (
            <button
              key={inst.id}
              onClick={() => navigate(`/instruments/${inst.id}`)}
              title={`${inst.name} — ${inst.status}`}
              className="surface-hover flex items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <StatusDot status={inst.status} showLabel={false} />
              <span className="max-w-[16rem] truncate">{inst.name}</span>
            </button>
          ))}
        </motion.div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* The two counts that matter, at across-the-room scale. */}
          <motion.div className="grid gap-5 sm:grid-cols-2" variants={fadeInUp}>
            <Card className="surface-raised">
              <CardContent className="p-6">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-success/15 text-success">
                  <CircleCheck className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="mt-5 flex items-end justify-between">
                  <div>
                    <p className="text-[15px] text-muted-foreground">Online</p>
                    <p className="display-number mt-1 text-6xl text-foreground">
                      <AnimatedNumber value={online} />
                    </p>
                  </div>
                  <p className="pb-1 text-sm text-muted-foreground">of {total}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="surface-raised">
              <CardContent className="p-6">
                <div
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full',
                    attention > 0 ? 'bg-destructive/15 text-destructive' : 'bg-secondary text-muted-foreground'
                  )}
                >
                  <TriangleAlert className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="mt-5 flex items-end justify-between">
                  <div>
                    <p className="text-[15px] text-muted-foreground">Needs attention</p>
                    <p
                      className={cn(
                        'display-number mt-1 text-6xl',
                        attention > 0 ? 'text-destructive' : 'text-foreground'
                      )}
                    >
                      <AnimatedNumber value={attention} />
                    </p>
                  </div>
                  <p className="pb-1 text-sm text-muted-foreground">
                    {attention > 0 ? 'offline / error / connecting' : 'all links healthy'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={fadeInUp}>
            <Card>
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <CardTitle>Result throughput</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Written to LIS, last 12 hours</p>
                </div>
                <div className="flex gap-6 text-right">
                  <div>
                    <p className="microlabel">Today</p>
                    <p className="display-number mt-1 text-2xl">
                      <AnimatedNumber value={stats?.resultsToday ?? 0} />
                    </p>
                  </div>
                  <div>
                    <p className="microlabel">Mapped</p>
                    <p className="display-number mt-1 text-2xl">
                      <AnimatedNumber value={stats?.mappedAnalytes ?? 0} />
                    </p>
                  </div>
                  <div>
                    <p className="microlabel">Errors</p>
                    <p
                      className={cn(
                        'display-number mt-1 text-2xl',
                        (stats?.errorsToday ?? 0) > 0 && 'text-destructive'
                      )}
                    >
                      <AnimatedNumber value={stats?.errorsToday ?? 0} />
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-foreground">
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={perHour}>
                    <defs>
                      <linearGradient id="throughput-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="currentColor" stopOpacity={0.14} />
                        <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="4 6"
                      stroke="currentColor"
                      strokeOpacity={0.08}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="hour"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      dy={6}
                    />
                    <YAxis
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      width={28}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border) / 0.15)',
                        borderRadius: 16,
                        fontSize: 12,
                        color: 'hsl(var(--foreground))'
                      }}
                      labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                      cursor={{ stroke: 'currentColor', strokeOpacity: 0.15 }}
                    />
                    {hourlyAvg > 0 && (
                      <ReferenceLine
                        y={hourlyAvg}
                        stroke="currentColor"
                        strokeOpacity={0.35}
                        strokeDasharray="6 6"
                        label={{
                          value: `avg ${Math.round(hourlyAvg)}`,
                          position: 'insideTopRight',
                          fill: 'hsl(var(--muted-foreground))',
                          fontSize: 11
                        }}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      fill="url(#throughput-fill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Live pipeline rail — what just flowed, stage by stage. */}
        <motion.div variants={fadeInUp} className="min-h-0 lg:max-h-[604px]">
          <Card className="flex h-full flex-col">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Live pipeline</CardTitle>
              <Badge tone="muted">{monitor.length} events</Badge>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-0.5">
                <AnimatePresence initial={false}>
                  {monitor.slice(0, 30).map((evt) => (
                    <motion.div
                      key={evt.id}
                      layout
                      variants={listItem}
                      initial="hidden"
                      animate="show"
                      exit="exit"
                      className="rounded-2xl px-3 py-2 text-sm transition-colors hover:bg-secondary/60"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn('microlabel !tracking-[0.1em]', stageTone[evt.stage])}>
                          {evt.stage}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                          {formatTime(evt.timestamp)}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate">
                        <span className="font-mono text-xs text-muted-foreground">{evt.sampleId}</span>{' '}
                        <span className="font-medium">{evt.analyteCode}</span>
                        {evt.value !== undefined && evt.value !== '' && (
                          <>
                            {' = '}
                            <span className="tabular-nums">{evt.value}</span>{' '}
                            <span className="text-xs text-muted-foreground">{evt.unit}</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">{evt.instrumentName}</span>
                        {evt.mappedTo && (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                            <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} /> {evt.mappedTo}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {monitor.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Waiting for instrument activity…
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}
