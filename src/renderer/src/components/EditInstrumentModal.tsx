import { useEffect, useMemo, useState } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Label, Select } from '@/components/ui/Input'
import { Switch } from '@/components/ui/Switch'
import { useAppStore } from '@/store/useAppStore'
import type { InstrumentRuntime, SerialPortInfo, TransportKind } from '@shared/types'

/**
 * Edit the connection config of an already-onboarded instrument so a setting can
 * be changed in place (no delete + re-add). The driver/model is fixed here —
 * switching model is effectively a different instrument and belongs in the Add
 * flow. Advanced fields the form doesn't surface (poll/idle/autoEag/autoIdentify)
 * are preserved verbatim. Saving calls instruments.update, which stops and
 * restarts the connection with the new config.
 */
export function EditInstrumentModal({
  open,
  onClose,
  instrument
}: {
  open: boolean
  onClose: () => void
  instrument: InstrumentRuntime
}) {
  const drivers = useAppStore((s) => s.drivers)
  const driver = useMemo(
    () => drivers.find((d) => d.id === instrument.driverId),
    [drivers, instrument.driverId]
  )

  const c = instrument.connection
  const [name, setName] = useState(instrument.name)
  const [transport, setTransport] = useState<TransportKind>(c.transport)
  const [host, setHost] = useState(c.host ?? '127.0.0.1')
  const [port, setPort] = useState(String(c.port ?? 9100))
  const [serialPath, setSerialPath] = useState(c.serialPath ?? 'COM3')
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [portsLoading, setPortsLoading] = useState(false)
  const [portsScanned, setPortsScanned] = useState(false)
  const [baudRate, setBaudRate] = useState(String(c.baudRate ?? 9600))
  const [dataBits, setDataBits] = useState(String(c.dataBits ?? 8))
  const [parity, setParity] = useState(c.parity ?? 'none')
  const [stopBits, setStopBits] = useState(String(c.stopBits ?? 1))
  const [hostQuery, setHostQuery] = useState(!!c.hostQuery)
  const [passive, setPassive] = useState(!!c.passive)
  const [enabled, setEnabled] = useState(instrument.enabled)
  const [saving, setSaving] = useState(false)

  // Re-seed every field from the instrument whenever the modal (re)opens or a
  // different instrument is passed in, so it always reflects the current config.
  useEffect(() => {
    if (!open) return
    const cur = instrument.connection
    setName(instrument.name)
    setTransport(cur.transport)
    setHost(cur.host ?? '127.0.0.1')
    setPort(String(cur.port ?? 9100))
    setSerialPath(cur.serialPath ?? 'COM3')
    setBaudRate(String(cur.baudRate ?? 9600))
    setDataBits(String(cur.dataBits ?? 8))
    setParity(cur.parity ?? 'none')
    setStopBits(String(cur.stopBits ?? 1))
    setHostQuery(!!cur.hostQuery)
    setPassive(!!cur.passive)
    setEnabled(instrument.enabled)
    setPortsScanned(false)
  }, [open, instrument])

  const refreshPorts = async (): Promise<void> => {
    setPortsLoading(true)
    try {
      setPorts(await window.api.serial.listPorts())
    } finally {
      setPortsScanned(true)
      setPortsLoading(false)
    }
  }

  // Enumerate COM ports the first time the serial config is shown.
  useEffect(() => {
    if (open && transport === 'serial' && !portsScanned && !portsLoading) {
      void refreshPorts()
    }
  }, [open, transport, portsScanned, portsLoading])

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.instruments.update(instrument.id, {
        name: name.trim() || instrument.name,
        enabled,
        connection: {
          // Preserve advanced fields the form doesn't expose (poll/idle/autoEag/
          // autoIdentify) — update() replaces the whole connection object.
          ...instrument.connection,
          transport,
          host: transport === 'tcp-server' ? '0.0.0.0' : host,
          port: transport === 'serial' ? undefined : Number(port),
          serialPath: transport === 'serial' ? serialPath : undefined,
          baudRate: transport === 'serial' ? Number(baudRate) : undefined,
          dataBits: transport === 'serial' ? (Number(dataBits) as 7 | 8) : undefined,
          parity: transport === 'serial' ? (parity as 'none' | 'even' | 'odd') : undefined,
          stopBits: transport === 'serial' ? (Number(stopBits) as 1 | 2) : undefined,
          hostQuery: passive ? false : hostQuery,
          passive
        }
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Instrument"
      description="Change the connection configuration — the instrument reconnects on save"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </>
      }
      className="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Check className="h-4 w-4" /> {driver?.name ?? instrument.driverId}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {driver?.vendor}
            {driver?.category ? ` - ${driver.category}` : ''} · Model is fixed; to change it, add a
            new instrument.
          </p>
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
              {(driver?.transports ?? [transport]).map((t) => (
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
                list="edit-serial-ports"
                autoComplete="off"
              />
              <datalist id="edit-serial-ports">
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
              <Select value={parity} onChange={(e) => setParity(e.target.value as 'none' | 'even' | 'odd')}>
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
            <p className="text-sm font-medium">Enabled</p>
            <p className="text-xs text-muted-foreground">Listen/connect when running</p>
          </div>
          <Switch checked={enabled} onChange={setEnabled} />
        </div>
      </div>
    </Modal>
  )
}
