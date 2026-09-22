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
import { PageHeader } from '@/components/layout/PageHeader'
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
  const [copiedIp, setCopiedIp] = useState<string | null>(null)

  useEffect(() => {
    loadSubnets().then((subs) => {
      const def = subs.find((s) => !s.isVirtual) ?? subs[0]
      if (def) setCidr(def.cidr)
    })
  }, [loadSubnets])

  const candidates = useMemo(() => hosts.filter((h) => h.guessedDriverId), [hosts])

  // Free IPs = the scanned /24 (.1–.254) minus every host that responded or was
  // in the ARP cache. Heuristic ("no device answered"), handy for picking a
  // static address when adding an instrument.
  const freeIps = useMemo(() => {
    if (!progress) return []
    const base = progress.cidr.split('/')[0].split('.').slice(0, 3).join('.')
    const used = new Set(hosts.map((h) => h.ip))
    const out: string[] = []
    for (let i = 1; i <= 254; i++) {
      const ip = `${base}.${i}`
      if (!used.has(ip)) out.push(ip)
    }
    return out
  }, [progress, hosts])

  const copyIp = (ip: string): void => {
    void navigator.clipboard?.writeText(ip)
    setCopiedIp(ip)
    setTimeout(() => setCopiedIp((c) => (c === ip ? null : c)), 1200)
  }

  const addAsInstrument = (h: DiscoveredHost): void => {
    const port = h.openPorts.find((p) => p.service.startsWith('Instrument'))?.port ?? h.openPorts[0]?.port
    setPrefill({ host: h.ip, port, driverId: h.guessedDriverId || 'generic-astm' })
    setModalOpen(true)
  }

  return (
    <motion.div className="space-y-6" variants={staggerContainer} initial="hidden" animate="show">
      <motion.div variants={fadeInUp}>
        <PageHeader title="Network discovery" subtitle="Read-only scan for instruments on your LAN">
          {scanning ? (
            <Button variant="danger" onClick={stop}>
              <Square className="h-4 w-4" strokeWidth={1.75} /> Stop
            </Button>
          ) : (
            <Button onClick={() => scan(cidr)} disabled={!cidr}>
              <Radar className="h-4 w-4" strokeWidth={1.75} /> Scan network
            </Button>
          )}
        </PageHeader>
      </motion.div>

      <motion.div className="flex items-start gap-3 rounded-3xl bg-secondary/40 p-4" variants={fadeInUp}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="text-sm">
          <p className="font-medium">Read-only discovery</p>
          <p className="text-muted-foreground">
            Stellar Synapse probes the selected subnet using TCP connect checks and reads the local
            ARP cache. No data is sent to any device and no settings are changed.
          </p>
        </div>
      </motion.div>

      <motion.div variants={fadeInUp}>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-6">
          <Radar className={cn('h-5 w-5 text-muted-foreground', scanning && 'animate-spin')} strokeWidth={1.75} />
          <Select value={cidr} onChange={(e) => setCidr(e.target.value)} className="w-72" disabled={scanning}>
            {subnets.map((s) => (
              <option key={s.cidr + s.interfaceName} value={s.cidr}>
                {s.cidr} - {s.interfaceName}
                {s.isVirtual ? ' (virtual)' : ''}
              </option>
            ))}
          </Select>

          <div className="ml-auto flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {hosts.length} host{hosts.length === 1 ? '' : 's'} - {candidates.length} likely analyzer
              {candidates.length === 1 ? '' : 's'}
            </span>
          </div>

          {progress && (
            <div className="w-full">
              <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                <span>{scanning ? `Scanning ${progress.cidr}...` : 'Scan complete'}</span>
                <span className="tabular-nums">{progress.percent}%</span>
              </div>
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className="h-full rounded-full bg-foreground"
                  animate={{ width: `${progress.percent}%` }}
                  transition={{ ease: 'easeOut', duration: 0.4 }}
                />
                {scanning && (
                  <div className="pointer-events-none absolute inset-0 animate-shimmer bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.1),transparent)]" />
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
                <tr className="border-b border-border text-left">
                  <th className="microlabel px-5 py-3 text-left">IP address</th>
                  <th className="microlabel px-5 py-3 text-left">Type</th>
                  <th className="microlabel px-5 py-3 text-left">MAC / vendor</th>
                  <th className="microlabel px-5 py-3 text-left">Open ports</th>
                  <th className="microlabel px-5 py-3 text-right">Action</th>
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
                      className="border-b border-border transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-5 py-3">
                        <span className="font-mono font-medium tabular-nums">{h.ip}</span>
                        {h.isSelf && <Badge tone="muted" className="ml-2">self</Badge>}
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-2">
                          <kind.icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
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
                              className="font-mono tabular-nums"
                            >
                              {p.port}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {!h.isSelf && (h.guessedDriverId || h.openPorts.length > 0) ? (
                          <Button variant="ghost" size="sm" onClick={() => addAsInstrument(h)}>
                            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> Add
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
                    <td colSpan={5} className="px-5 py-10 text-center text-sm text-muted-foreground">
                      {scanning ? 'Scanning the network...' : 'No scan yet. Choose a subnet and press Scan network.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </motion.div>

      {progress?.done && !scanning && (
        <motion.div variants={fadeInUp}>
          <Card>
            <CardContent className="p-6">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">Available IPs</p>
                <Badge tone="success">{freeIps.length}</Badge>
                <span className="text-xs text-muted-foreground">
                  No device responded on this subnet — likely free to assign (click to copy)
                </span>
              </div>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {freeIps.map((ip) => (
                  <button
                    key={ip}
                    type="button"
                    onClick={() => copyIp(ip)}
                    title="Click to copy"
                    className={cn(
                      'rounded-full bg-secondary/60 px-2.5 py-1 font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                      copiedIp === ip && 'bg-success/15 text-success'
                    )}
                  >
                    {copiedIp === ip ? 'Copied!' : ip}
                  </button>
                ))}
                {freeIps.length === 0 && (
                  <span className="text-xs text-muted-foreground">No free IPs in this subnet.</span>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

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
