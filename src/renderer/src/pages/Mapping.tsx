import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Wand2, Pencil, Search, Network } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { PageHeader } from '@/components/layout/PageHeader'
import { MappingEditor } from '@/components/MappingEditor'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'
import { fadeInUp, listItem, staggerContainer } from '@/lib/motion'
import type { MappingRule, MappingStatus } from '@shared/types'

const statusTone: Record<MappingStatus, 'success' | 'primary' | 'warning' | 'muted'> = {
  auto: 'primary',
  manual: 'success',
  unmapped: 'warning',
  ignored: 'muted'
}

export function Mapping() {
  const mappings = useAppStore((s) => s.mappings)
  const drivers = useAppStore((s) => s.drivers)
  const [driverId, setDriverId] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<MappingRule | null>(null)
  const [autoBusy, setAutoBusy] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return mappings.filter((m) => {
      if (driverId !== 'all' && m.driverId !== driverId) return false
      if (status !== 'all' && m.status !== status) return false
      if (q && !m.instrumentCode.toLowerCase().includes(q) && !(m.instrumentName ?? '').toLowerCase().includes(q))
        return false
      return true
    })
  }, [mappings, driverId, status, search])

  const stats = useMemo(() => {
    const scope = driverId === 'all' ? mappings : mappings.filter((m) => m.driverId === driverId)
    return {
      total: scope.length,
      mapped: scope.filter((m) => m.status === 'auto' || m.status === 'manual').length,
      unmapped: scope.filter((m) => m.status === 'unmapped').length
    }
  }, [mappings, driverId])

  const runAutoMap = async (): Promise<void> => {
    setAutoBusy(true)
    try {
      const targets = driverId === 'all' ? drivers.map((d) => d.id) : [driverId]
      for (const id of targets) await window.api.mappings.autoMap(id)
    } finally {
      setAutoBusy(false)
    }
  }

  const driverName = (id: string): string => drivers.find((d) => d.id === id)?.name ?? id

  return (
    <motion.div className="space-y-6" variants={staggerContainer} initial="hidden" animate="show">
      <motion.div variants={fadeInUp}>
        <PageHeader title="Parameter mapping" subtitle="Map instrument analytes to Noble LIS tests">
          <Button onClick={runAutoMap} disabled={autoBusy}>
            <Wand2 className={cn('h-4 w-4', autoBusy && 'animate-spin')} strokeWidth={1.75} />{' '}
            {autoBusy ? 'Mapping...' : 'Auto-map'}
          </Button>
        </PageHeader>
      </motion.div>

      <motion.div className="grid gap-5 sm:grid-cols-3" variants={staggerContainer}>
        <motion.div variants={fadeInUp}>
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-foreground">
                <Network className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div>
                <p className="display-number text-4xl"><AnimatedNumber value={stats.total} /></p>
                <p className="microlabel mt-1">Total analytes</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={fadeInUp}>
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/15 text-success">
                <Network className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div>
                <p className="display-number text-4xl text-success"><AnimatedNumber value={stats.mapped} /></p>
                <p className="microlabel mt-1">Mapped to LIS</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={fadeInUp}>
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/15 text-warning">
                <Network className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div>
                <p className="display-number text-4xl text-warning"><AnimatedNumber value={stats.unmapped} /></p>
                <p className="microlabel mt-1">Needs mapping</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      <motion.div variants={fadeInUp}>
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search analyte code or name..."
                className="pl-9"
              />
            </div>
            <Select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="w-48">
              <option value="all">All instruments</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
              <option value="all">All statuses</option>
              <option value="auto">Auto</option>
              <option value="manual">Manual</option>
              <option value="unmapped">Unmapped</option>
              <option value="ignored">Ignored</option>
            </Select>
          </div>
        </CardContent>
      </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="microlabel px-5 py-3 text-left">Instrument analyte</th>
                  <th className="microlabel px-5 py-3 text-left">Source</th>
                  <th className="microlabel px-5 py-3 text-left">LIS test / parameter</th>
                  <th className="microlabel px-5 py-3 text-left">Unit</th>
                  <th className="microlabel px-5 py-3 text-left">Status</th>
                  <th className="microlabel px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                {filtered.map((m) => (
                  <motion.tr
                    key={m.id}
                    variants={listItem}
                    initial="hidden"
                    animate="show"
                    exit="exit"
                    className="border-b border-border transition-colors hover:bg-secondary/40"
                  >
                    <td className="px-5 py-3">
                      <div className="font-mono font-medium text-accent">{m.instrumentCode}</div>
                      <div className="text-xs text-muted-foreground">{m.instrumentName}</div>
                      {m.analyzerCode && m.analyzerCode !== m.instrumentCode && (
                        <div className="font-mono text-xs text-foreground/70">→ {m.analyzerCode}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{driverName(m.driverId)}</td>
                    <td className="px-5 py-3">
                      {m.lisTestName ? (
                        <div>
                          <span className="font-medium">{m.lisParamName ?? m.lisTestName}</span>
                          {m.lisParamName && (
                            <span className="ml-2 text-xs text-muted-foreground">in {m.lisTestName}</span>
                          )}
                          <div className="font-mono text-xs text-muted-foreground">{m.lisTestCode}</div>
                        </div>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">- not mapped -</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{m.unit ?? '-'}</td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone[m.status]}>
                        {m.status}
                        {m.status === 'auto' && m.confidence != null && (
                          <span className="tabular-nums opacity-70">{Math.round(m.confidence * 100)}%</span>
                        )}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} /> Edit
                      </Button>
                    </td>
                  </motion.tr>
                ))}
                </AnimatePresence>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">
                      No analytes match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </motion.div>

      <MappingEditor rule={editing} onClose={() => setEditing(null)} />
    </motion.div>
  )
}
