import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Wand2, Pencil, Search, Network } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
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
      <motion.div className="grid gap-4 sm:grid-cols-3" variants={staggerContainer}>
        <motion.div variants={fadeInUp}>
          <Card interactive className="group">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary transition-transform duration-300 group-hover:scale-110">
                <Network className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold"><AnimatedNumber value={stats.total} /></p>
                <p className="text-xs text-muted-foreground">Total analytes</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={fadeInUp}>
          <Card interactive className="group">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/15 text-success transition-transform duration-300 group-hover:scale-110">
                <Network className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-success"><AnimatedNumber value={stats.mapped} /></p>
                <p className="text-xs text-muted-foreground">Mapped to LIS</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div variants={fadeInUp}>
          <Card interactive className="group">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/15 text-warning transition-transform duration-300 group-hover:scale-110">
                <Network className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-warning"><AnimatedNumber value={stats.unmapped} /></p>
                <p className="text-xs text-muted-foreground">Needs mapping</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      <motion.div variants={fadeInUp}>
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
            <Button variant="secondary" onClick={runAutoMap} disabled={autoBusy}>
              <Wand2 className={cn('h-4 w-4', autoBusy && 'animate-spin')} /> {autoBusy ? 'Mapping...' : 'Auto-map'}
            </Button>
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
                <tr className="border-b border-border/60 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Instrument Analyte</th>
                  <th className="px-5 py-3 font-medium">Source</th>
                  <th className="px-5 py-3 font-medium">LIS Test / Parameter</th>
                  <th className="px-5 py-3 font-medium">Unit</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Action</th>
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
                    className="border-b border-border/30 hover:bg-secondary/30"
                  >
                    <td className="px-5 py-3">
                      <div className="font-mono font-semibold text-accent">{m.instrumentCode}</div>
                      <div className="text-xs text-muted-foreground">{m.instrumentName}</div>
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
                          <span className="opacity-70">{Math.round(m.confidence * 100)}%</span>
                        )}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                    </td>
                  </motion.tr>
                ))}
                </AnimatePresence>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground">
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
