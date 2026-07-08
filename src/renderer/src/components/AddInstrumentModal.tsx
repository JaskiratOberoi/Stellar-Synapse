import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Cpu, RefreshCw, Search } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Switch } from '@/components/ui/Switch'
import { useAppStore } from '@/store/useAppStore'
import type { AuOnlineTestNo, InstrumentDriverInfo, SerialPortInfo, TransportKind } from '@shared/types'

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
  const presets = useAppStore((s) => s.presets)
  const [step, setStep] = useState(1)
  const [driver, setDriver] = useState<InstrumentDriverInfo | null>(null)
  const [name, setName] = useState('')
  const [presetKey, setPresetKey] = useState('')
  const [auOnlineTestNos, setAuOnlineTestNos] = useState<AuOnlineTestNo[] | undefined>(undefined)
  const [transport, setTransport] = useState<TransportKind>('tcp-server')
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('9100')
  const [serialPath, setSerialPath] = useState('COM3')
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [portsLoading, setPortsLoading] = useState(false)
  const [portsScanned, setPortsScanned] = useState(false)
  const [baudRate, setBaudRate] = useState('9600')
  const [dataBits, setDataBits] = useState('8')
  const [parity, setParity] = useState('none')
  const [stopBits, setStopBits] = useState('1')
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
    setPresetKey('')
    setAuOnlineTestNos(undefined)
    setTransport('tcp-server')
    setHost('127.0.0.1')
    setPort('9100')
    setSerialPath('COM3')
    setPorts([])
    setPortsLoading(false)
    setPortsScanned(false)
    setBaudRate('9600')
    setDataBits('8')
    setParity('none')
    setStopBits('1')
    setHostQuery(false)
    setPassive(false)
    setEnabled(true)
    setQuery('')
    setVendor('all')
  }

  const refreshPorts = async (): Promise<void> => {
    setPortsLoading(true)
    try {
      setPorts(await window.api.serial.listPorts())
    } finally {
      setPortsScanned(true)
      setPortsLoading(false)
    }
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

  // Enumerate COM ports the first time the serial config is shown.
  useEffect(() => {
    if (step === 2 && transport === 'serial' && !portsScanned && !portsLoading) {
      void refreshPorts()
    }
  }, [step, transport, portsScanned, portsLoading])

  // Presets that carry settings for the currently selected driver.
  const driverPresets = useMemo(
    () => (driver ? presets.filter((p) => p.instruments.some((i) => i.driverId === driver.id)) : []),
    [presets, driver]
  )

  /** Apply a location preset's settings to the config form (or clear on ''). */
  const applyPreset = (slug: string): void => {
    setPresetKey(slug)
    if (!slug || !driver) {
      setAuOnlineTestNos(undefined)
      return
    }
    const preset = presets.find((p) => p.preset === slug)
    const inst = preset?.instruments.find((i) => i.driverId === driver.id)
    if (!preset || !inst) {
      setAuOnlineTestNos(undefined)
      return
    }
    if (inst.transport) setTransport(inst.transport)
    if (inst.port != null) setPort(String(inst.port))
    if (inst.serial) {
      if (inst.serial.baudRate != null) setBaudRate(String(inst.serial.baudRate))
      if (inst.serial.dataBits != null) setDataBits(String(inst.serial.dataBits))
      if (inst.serial.parity) setParity(inst.serial.parity)
      if (inst.serial.stopBits != null) setStopBits(String(inst.serial.stopBits))
    }
    // The per-site Beckman AU Online Test No. map travels with the instrument so
    // results decode under THIS lab's numbering, not the driver default.
    setAuOnlineTestNos(inst.auOnlineTestNos?.length ? inst.auOnlineTestNos : undefined)
    setName(`${driver.name} — ${preset.location}`)
  }

  const choose = (d: InstrumentDriverInfo): void => {
    setDriver(d)
    setName(`${d.name}`)
    setPresetKey('')
    setAuOnlineTestNos(undefined)
    setTransport(d.transports[0])
    setPort(String(d.defaultPort ?? 9100))
    setHostQuery(d.mode === 'bidirectional')
    // Real AU480 "Online" host links run 8-N-1 (confirmed on-analyzer); a location
    // preset can still override this. Most other ASTM serial is also 8-N-1.
    setDataBits('8')
    setParity('none')
    setStopBits('1')
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
          dataBits: transport === 'serial' ? (Number(dataBits) as 7 | 8) : undefined,
          parity: transport === 'serial' ? (parity as 'none' | 'even' | 'odd') : undefined,
          stopBits: transport === 'serial' ? (Number(stopBits) as 1 | 2) : undefined,
          hostQuery: passive ? false : hostQuery,
          passive,
          autoIdentify: passive
        },
        auOnline: auOnlineTestNos ? { testNos: auOnlineTestNos } : undefined
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

          {driverPresets.length > 0 && (
            <div className="space-y-1.5">
              <Label>Preset (lab location)</Label>
              <Select value={presetKey} onChange={(e) => applyPreset(e.target.value)}>
                <option value="">Manual configuration</option>
                {driverPresets.map((p) => (
                  <option key={p.preset} value={p.preset}>
                    {p.location}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                {presetKey
                  ? `Applied ${driverPresets.find((p) => p.preset === presetKey)?.location} settings` +
                    (auOnlineTestNos ? ` + ${auOnlineTestNos.length}-test AU Online map` : '') +
                    '. Adjust below if needed.'
                  : 'Auto-fill connection, serial, and (Beckman AU) the site Online Test No. map from a saved location.'}
              </p>
            </div>
          )}

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
                <div className="flex items-center justify-between">
                  <Label>COM Port</Label>
                  <button
                    type="button"
                    onClick={refreshPorts}
                    disabled={portsLoading}
                    className="flex items-center gap-1 text-xs text-primary transition-opacity hover:opacity-80 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${portsLoading ? 'animate-spin' : ''}`} />
                    {portsLoading ? 'Detecting...' : 'Detect'}
                  </button>
                </div>
                <Input
                  value={serialPath}
                  onChange={(e) => setSerialPath(e.target.value)}
                  placeholder="COM3"
                  list="serial-ports"
                  autoComplete="off"
                />
                <datalist id="serial-ports">
                  {ports.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.friendlyName ?? p.manufacturer ?? p.path}
                    </option>
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                  {portsLoading
                    ? 'Scanning serial ports...'
                    : ports.length > 0
                      ? `${ports.length} detected: ${ports.map((p) => p.path).join(', ')}`
                      : portsScanned
                        ? 'No ports detected - type the COM port manually.'
                        : ''}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Port</Label>
                <Input
                  value={port}
                  onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                  inputMode="numeric"
                  placeholder="55555"
                  autoComplete="off"
                />
              </div>
            )}
          </div>

          {transport === 'tcp-client' && (
            <div className="space-y-1.5">
              <Label>Analyzer Host / IP</Label>
              <Input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="e.g. 192.168.1.150"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

          {transport === 'serial' && (
            <div className="grid grid-cols-2 gap-3">
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
              <div className="space-y-1.5">
                <Label>Data Bits</Label>
                <Select value={dataBits} onChange={(e) => setDataBits(e.target.value)}>
                  {['8', '7'].map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Parity</Label>
                <Select value={parity} onChange={(e) => setParity(e.target.value)}>
                  {['none', 'even', 'odd'].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Stop Bits</Label>
                <Select value={stopBits} onChange={(e) => setStopBits(e.target.value)}>
                  {['1', '2'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
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
