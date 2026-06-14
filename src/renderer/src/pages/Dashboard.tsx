import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts'
import { AnimatePresence, motion } from 'framer-motion'
import { Cpu, FlaskConical, Network, TriangleAlert, ArrowUpRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { StatusDot } from '@/components/ui/StatusDot'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { useAppStore } from '@/store/useAppStore'
import { cn, formatTime } from '@/lib/utils'
import { fadeInUp, listItem, staggerContainer } from '@/lib/motion'
import type { MonitorStage } from '@shared/types'

const stageTone: Record<MonitorStage, string> = {
  received: 'text-muted-foreground',
  decoded: 'text-accent',
  mapped: 'text-primary',
  written: 'text-success',
  skipped: 'text-warning',
  error: 'text-destructive'
}

function Stat({
  label,
  value,
  numericValue,
  icon: Icon,
  tone,
  hint
}: {
  label: string
  value?: string | number
  numericValue?: number
  icon: React.ElementType
  tone: string
  hint?: string
}) {
  return (
    <motion.div variants={fadeInUp}>
      <Card interactive className="group relative overflow-hidden">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <p className="mt-2 text-3xl font-bold tracking-tight">
                {numericValue !== undefined ? <AnimatedNumber value={numericValue} /> : value}
              </p>
              {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
            </div>
            <div
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110',
                tone
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function Dashboard() {
  const stats = useAppStore((s) => s.stats)
  const instruments = useAppStore((s) => s.instruments)
  const monitor = useAppStore((s) => s.monitor)

  return (
    <motion.div
      className="space-y-6"
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      <motion.div className="stat-grid" variants={staggerContainer}>
        <Stat
          label="Instruments Online"
          value={`${stats?.instrumentsOnline ?? 0}/${stats?.instrumentsTotal ?? 0}`}
          icon={Cpu}
          tone="bg-primary/15 text-primary"
          hint="Active analyzer connections"
        />
        <Stat
          label="Results Today"
          numericValue={stats?.resultsToday ?? 0}
          icon={FlaskConical}
          tone="bg-success/15 text-success"
          hint="Written to LIS"
        />
        <Stat
          label="Mapped Analytes"
          numericValue={stats?.mappedAnalytes ?? 0}
          icon={Network}
          tone="bg-accent/15 text-accent"
          hint={`${stats?.unmappedAnalytes ?? 0} unmapped`}
        />
        <Stat
          label="Errors Today"
          numericValue={stats?.errorsToday ?? 0}
          icon={TriangleAlert}
          tone="bg-destructive/15 text-destructive"
          hint="Pipeline failures"
        />
      </motion.div>

      <motion.div className="grid gap-6 lg:grid-cols-3" variants={fadeInUp}>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Result Throughput</CardTitle>
            <p className="text-sm text-muted-foreground">Results written to LIS over the last 12 hours</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={stats?.resultsPerHour ?? []}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(246 80% 65%)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(246 80% 65%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 28% 18%)" vertical={false} />
                <XAxis dataKey="hour" stroke="hsl(215 18% 60%)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(215 18% 60%)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(222 44% 10%)',
                    border: '1px solid hsl(222 28% 18%)',
                    borderRadius: 12,
                    fontSize: 12
                  }}
                  labelStyle={{ color: 'hsl(213 31% 91%)' }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="hsl(246 80% 65%)"
                  strokeWidth={2}
                  fill="url(#g)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Instrument Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {instruments.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No instruments configured</p>
            )}
            {instruments.map((inst) => (
              <div
                key={inst.id}
                className="flex items-center justify-between rounded-lg border border-border/40 bg-secondary/30 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{inst.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {inst.connection.transport} : {inst.connection.port ?? inst.connection.serialPath}
                  </p>
                </div>
                <StatusDot status={inst.status} showLabel={false} />
              </div>
            ))}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Live Activity</CardTitle>
            <Badge tone="muted">{monitor.length} events</Badge>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <AnimatePresence initial={false}>
                {monitor.slice(0, 12).map((evt) => (
                  <motion.div
                    key={evt.id}
                    layout
                    variants={listItem}
                    initial="hidden"
                    animate="show"
                    exit="exit"
                    className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-secondary/40"
                  >
                    <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
                      {formatTime(evt.timestamp)}
                    </span>
                    <span className={cn('w-16 shrink-0 text-xs font-semibold uppercase', stageTone[evt.stage])}>
                      {evt.stage}
                    </span>
                    <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">
                      {evt.instrumentName}
                    </span>
                    <span className="flex-1 truncate">
                      <span className="font-mono text-xs text-accent">{evt.sampleId}</span>{' '}
                      <span className="font-medium">{evt.analyteCode}</span>
                      {' = '}
                      <span className="font-semibold">{evt.value}</span>{' '}
                      <span className="text-xs text-muted-foreground">{evt.unit}</span>
                    </span>
                    {evt.mappedTo && (
                      <span className="hidden items-center gap-1 text-xs text-muted-foreground xl:flex">
                        <ArrowUpRight className="h-3 w-3" /> {evt.mappedTo}
                      </span>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {monitor.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Waiting for instrument activity...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
