import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Radar,
  ShieldCheck,
  Server,
  Plus,
  Database,
  HardDrive,
  Laptop,
  CircleHelp,
  Square
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import { AddInstrumentModal, type InstrumentPrefill } from '@/components/AddInstrumentModal'
import { useDiscoveryStore } from '@/store/useDiscoveryStore'
import { cn } from '@/lib/utils'
import { fadeInUp, listItem, staggerContainer } from '@/lib/motion'
import type { DiscoveredHost } from '@shared/types'

function hostKind(h: DiscoveredHost): { icon: React.ElementType; label: string; tone: 'primary' | 'accent' | 'muted' | 'success' } {
  if (h.guessedDriverId) return { icon: Server, label: 'Likely analyzer', tone: 'primary' }
  if (h.openPorts.some((p) => p.port === 1433)) return { icon: Database, label: 'LIS database', tone: 'accent' }
  if (h.isSelf) return { icon: Laptop, label: 'This machine', tone: 'muted' }
  if (h.openPorts.some((p) => [80, 443, 8080].includes(p.port))) return { icon: HardDrive, label: 'Networked device', tone: 'success' }
  return { icon: CircleHelp, label: 'Unknown host', tone: 'muted' }
}

export function Discovery() {
  const { subnets, hosts, scanning, progress, loadSubnets, scan, stop } = useDiscoveryStore()
  const [cidr, setCidr] = useState('')
  const [prefill, setPrefill] = useState<InstrumentPrefill | undefined>()
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    loadSubnets().then((subs) => {
      const def = subs.find((s) => !s.isVirtual) ?? subs[0]
      if (def) setCidr(def.cidr)
    })
  }, [loadSubnets])

  const candidates = useMemo(() => hosts.filter((h) => h.guessedDriverId), [hosts])

  const addAsInstrument = (h: DiscoveredHost): void => {
    const port = h.openPorts.find((p) => p.service.startsWith('Instrument'))?.port ?? h.openPorts[0]?.port
    setPrefill({ host: h.ip, port, driverId: h.guessedDriverId || 'generic-astm' })
    setModalOpen(true)
  }

  return (
    <motion.div className="space-y-6" variants={staggerContainer} initial="hidden" animate="show">
      <motion.div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/10 p-4" variants={fadeInUp}>
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div className="text-sm">
          <p className="font-semibold text-accent">Read-only discovery</p>
          <p className="text-muted-foreground">
            Stellar Synapse probes the selected subnet using TCP connect checks and reads the local
            ARP cache. No data is sent to any device and no settings are changed.
          </p>
        </div>
      </motion.div>

      <motion.div variants={fadeInUp}>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Radar className={cn('h-5 w-5 text-primary', scanning && 'animate-spin')} />
          <Select value={cidr} onChange={(e) => setCidr(e.target.value)} className="w-72" disabled={scanning}>
            {subnets.map((s) => (
              <option key={s.cidr + s.interfaceName} value={s.cidr}>
                {s.cidr} - {s.interfaceName}
                {s.isVirtual ? ' (virtual)' : ''}
              </option>
            ))}
          </Select>
          {scanning ? (
            <Button variant="danger" onClick={stop}>
              <Square className="h-4 w-4" /> Stop
            </Button>
          ) : (
            <Button onClick={() => scan(cidr)} disabled={!cidr}>
              <Radar className="h-4 w-4" /> Scan Network
            </Button>
          )}

          <div className="ml-auto flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {hosts.length} host{hosts.length === 1 ? '' : 's'} - {candidates.length} likely analyzer
              {candidates.length === 1 ? '' : 's'}
            </span>
          </div>

          {progress && (
            <div className="w-full">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>{scanning ? `Scanning ${progress.cidr}...` : 'Scan complete'}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                  animate={{ width: `${progress.percent}%` }}
                  transition={{ ease: 'easeOut', duration: 0.4 }}
                />
                {scanning && (
                  <div className="pointer-events-none absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                )}
              </div>
            </div>
          )}
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
                  <th className="px-5 py-3 font-medium">IP Address</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">MAC / Vendor</th>
                  <th className="px-5 py-3 font-medium">Open Ports</th>
                  <th className="px-5 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                {hosts.map((h) => {
                  const kind = hostKind(h)
                  return (
                    <motion.tr
                      key={h.ip}
                      variants={listItem}
                      initial="hidden"
                      animate="show"
                      exit="exit"
                      className="border-b border-border/30 hover:bg-secondary/30"
                    >
                      <td className="px-5 py-3">
                        <span className="font-mono font-semibold">{h.ip}</span>
                        {h.isSelf && <Badge tone="muted" className="ml-2">self</Badge>}
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-2">
                          <kind.icon className="h-4 w-4 text-muted-foreground" />
                          <Badge tone={kind.tone}>{kind.label}</Badge>
                        </span>
                        {h.guessedInstrument && (
                          <div className="mt-1 text-xs text-muted-foreground">{h.guessedInstrument}</div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {h.mac ? (
                          <div>
                            <div className="font-mono text-xs">{h.mac}</div>
                            <div className="text-xs text-muted-foreground">{h.vendor ?? 'Unknown vendor'}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {h.openPorts.length === 0 && (
                            <span className="text-xs text-muted-foreground">none responding</span>
                          )}
                          {h.openPorts.map((p) => (
                            <Badge
                              key={p.port}
                              tone={p.service.startsWith('Instrument') ? 'primary' : 'muted'}
                              title={p.service}
                            >
                              {p.port}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {!h.isSelf && (h.guessedDriverId || h.openPorts.length > 0) ? (
                          <Button variant="ghost" size="sm" onClick={() => addAsInstrument(h)}>
                            <Plus className="h-3.5 w-3.5" /> Add
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                    </motion.tr>
                  )
                })}
                </AnimatePresence>
                {hosts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-16 text-center text-sm text-muted-foreground">
                      {scanning ? 'Scanning the network...' : 'No scan yet. Choose a subnet and press Scan Network.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </motion.div>

      <AddInstrumentModal
        open={modalOpen}
        prefill={prefill}
        onClose={() => {
          setModalOpen(false)
          setPrefill(undefined)
        }}
      />
    </motion.div>
  )
}
