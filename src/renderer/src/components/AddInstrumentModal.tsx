import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Cpu, Search } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Switch } from '@/components/ui/Switch'
import { useAppStore } from '@/store/useAppStore'
import type { InstrumentDriverInfo, TransportKind } from '@shared/types'

const maturityTone = { stable: 'success', beta: 'warning', skeleton: 'muted' } as const

/** Optional prefill from network discovery ("Add as instrument"). */
export interface InstrumentPrefill {
  host?: string
  port?: number
  driverId?: string
}

export function AddInstrumentModal({
  open,
  onClose,
  prefill
}: {
  open: boolean
  onClose: () => void
  prefill?: InstrumentPrefill
}) {
  const drivers = useAppStore((s) => s.drivers)
  const [step, setStep] = useState(1)
  const [driver, setDriver] = useState<InstrumentDriverInfo | null>(null)
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<TransportKind>('tcp-server')
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('9100')
  const [serialPath, setSerialPath] = useState('COM3')
  const [baudRate, setBaudRate] = useState('9600')
  const [hostQuery, setHostQuery] = useState(false)
  const [passive, setPassive] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [vendor, setVendor] = useState('all')

  const vendors = useMemo(
    () => ['all', ...Array.from(new Set(drivers.map((d) => d.vendor))).sort()],
    [drivers]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return drivers.filter((d) => {
      if (vendor !== 'all' && d.vendor !== vendor) return false
      if (!q) return true
      return (
        d.name.toLowerCase().includes(q) ||
        d.vendor.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q)
      )
    })
  }, [drivers, query, vendor])

  const reset = (): void => {
    setStep(1)
    setDriver(null)
    setName('')
    setTransport('tcp-server')
    setHost('127.0.0.1')
    setPort('9100')
    setHostQuery(false)
    setPassive(false)
    setEnabled(true)
    setQuery('')
    setVendor('all')
  }

  // Apply discovery prefill: jump to config with the guessed driver, TCP-client
  // pointed at the discovered host/port.
  useEffect(() => {
    if (!open || !prefill) return
    const d =
      drivers.find((x) => x.id === prefill.driverId) ??
      drivers.find((x) => x.id === 'generic-astm') ??
      drivers[0]
    if (!d) return
    setDriver(d)
    setName(prefill.host ? `${d.name} @ ${prefill.host}` : d.name)
    setTransport('tcp-client')
    if (prefill.host) setHost(prefill.host)
    if (prefill.port) setPort(String(prefill.port))
    // Discovered instruments are tapped passively by default: connect, listen,
    // import - never write to the device or the LIS.
    setPassive(true)
    setHostQuery(false)
    setStep(2)
  }, [open, prefill, drivers])

  const choose = (d: InstrumentDriverInfo): void => {
    setDriver(d)
    setName(`${d.name}`)
    setTransport(d.transports[0])
    setPort(String(d.defaultPort ?? 9100))
    setHostQuery(d.mode === 'bidirectional')
    setStep(2)
  }

  const submit = async (): Promise<void> => {
    if (!driver) return
    setSaving(true)
    try {
      await window.api.instruments.add({
        name: name.trim() || driver.name,
        driverId: driver.id,
        protocol: driver.protocol,
        enabled,
        connection: {
          transport,
          host: transport === 'tcp-server' ? '0.0.0.0' : host,
          port: transport === 'serial' ? undefined : Number(port),
          serialPath: transport === 'serial' ? serialPath : undefined,
          baudRate: transport === 'serial' ? Number(baudRate) : undefined,
          hostQuery: passive ? false : hostQuery,
          passive,
          autoIdentify: passive
        }
      })
      reset()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const close = (): void => {
    reset()
    onClose()
  }

  const footer = useMemo(() => {
    if (step === 1) return <Button variant="outline" onClick={close}>Cancel</Button>
    return (
      <>
        <Button variant="outline" onClick={() => setStep(1)}>
          Back
        </Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Adding...' : 'Add Instrument'}
        </Button>
      </>
    )
  }, [step, saving, name, transport, host, port, serialPath, baudRate, hostQuery, enabled, driver])

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add Instrument"
      description={step === 1 ? 'Select an analyzer from the driver catalog' : 'Configure the connection'}
      footer={footer}
      className="max-w-2xl"
    >
      {step === 1 ? (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by model, vendor, or category..."
                className="pl-9"
              />
            </div>
            <Select value={vendor} onChange={(e) => setVendor(e.target.value)} className="sm:w-52">
              {vendors.map((v) => (
                <option key={v} value={v}>
                  {v === 'all' ? 'All vendors' : v}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {filtered.length} of {drivers.length} analyzers
          </p>
          <div className="grid max-h-[55vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            {filtered.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                No analyzers match your search.
              </p>
            )}
            {filtered.map((d) => (
            <button
              key={d.id}
              onClick={() => choose(d)}
              className="group flex flex-col gap-2 rounded-xl border border-border bg-secondary/30 p-4 text-left transition-all hover:border-primary/50 hover:bg-secondary/60"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Cpu className="h-4 w-4" />
                </div>
                <Badge tone={maturityTone[d.maturity]}>{d.maturity}</Badge>
              </div>
              <div>
                <p className="text-sm font-semibold">{d.name}</p>
                <p className="text-xs text-muted-foreground">{d.vendor} - {d.category}</p>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{d.description}</p>
              <div className="mt-1 flex items-center gap-2">
                <Badge tone="primary">{d.protocol.toUpperCase()}</Badge>
                <span className="flex items-center text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Configure <ChevronRight className="h-3 w-3" />
                </span>
              </div>
            </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Check className="h-4 w-4" /> {driver?.name}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{driver?.description}</p>
          </div>

          <div className="space-y-1.5">
            <Label>Instrument Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maglumi X3 - Bench 2" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Transport</Label>
              <Select
                value={transport}
                onChange={(e) => {
                  const t = e.target.value as TransportKind
                  setTransport(t)
                  if (t === 'tcp-client') setPassive(true)
                }}
              >
                {driver?.transports.map((t) => (
                  <option key={t} value={t}>
                    {t === 'tcp-server'
                      ? 'TCP Server (analyzer connects in)'
                      : t === 'tcp-client'
                        ? 'TCP Client (dial analyzer)'
                        : 'Serial (RS-232)'}
                  </option>
                ))}
              </Select>
            </div>

            {transport === 'serial' ? (
              <div className="space-y-1.5">
                <Label>COM Port</Label>
                <Input value={serialPath} onChange={(e) => setSerialPath(e.target.value)} placeholder="COM3" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Port</Label>
                <Input value={port} onChange={(e) => setPort(e.target.value)} type="number" />
              </div>
            )}
          </div>

          {transport === 'tcp-client' && (
            <div className="space-y-1.5">
              <Label>Analyzer Host / IP</Label>
              <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" />
            </div>
          )}

          {transport === 'serial' && (
            <div className="space-y-1.5">
              <Label>Baud Rate</Label>
              <Select value={baudRate} onChange={(e) => setBaudRate(e.target.value)}>
                {['9600', '19200', '38400', '57600', '115200'].map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <div className="pr-3">
              <p className="text-sm font-medium text-amber-300">Passive (read-only tap)</p>
              <p className="text-xs text-muted-foreground">
                Connect and listen only - never writes to the analyzer or the LIS DB. Safe for live
                instruments already talking to another host.
              </p>
            </div>
            <Switch checked={passive} onChange={setPassive} />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Host Query</p>
              <p className="text-xs text-muted-foreground">
                {passive
                  ? 'Disabled in passive mode (no writes to the analyzer)'
                  : 'Analyzer asks the LIS which tests to run by barcode'}
              </p>
            </div>
            <Switch
              checked={passive ? false : hostQuery}
              onChange={setHostQuery}
              disabled={passive || driver?.mode === 'unidirectional'}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Start immediately</p>
              <p className="text-xs text-muted-foreground">Begin listening as soon as it is added</p>
            </div>
            <Switch checked={enabled} onChange={setEnabled} />
          </div>
        </div>
      )}
    </Modal>
  )
}
