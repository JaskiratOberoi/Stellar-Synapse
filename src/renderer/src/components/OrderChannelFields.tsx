import { Input, Label, Select } from '@/components/ui/Input'

/**
 * Endpoint of an analyzer's SEPARATE order-download connection (IHE LAW "server
 * channel" — Abbott Alinity). The main transport above carries the analyzer's
 * queries and results; orders go out on this one. Shown only for drivers flagged
 * `separateOrderChannel`, and only while host query is on.
 */
export function OrderChannelFields({
  transport,
  host,
  port,
  onTransport,
  onHost,
  onPort
}: {
  transport: 'tcp-client' | 'tcp-server'
  host: string
  port: string
  onTransport: (t: 'tcp-client' | 'tcp-server') => void
  onHost: (v: string) => void
  onPort: (v: string) => void
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-secondary/30 px-4 py-3">
      <div>
        <p className="text-sm font-medium">Order download channel</p>
        <p className="text-xs text-muted-foreground">
          The analyzer receives orders on a second connection (its &quot;receiver&quot; channel).
          Enter the receiver port it listens on — or, if its receiver channel is set to connect
          out, the port Synapse should listen on for it.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Direction</Label>
          <Select
            value={transport}
            onChange={(e) => onTransport(e.target.value as 'tcp-client' | 'tcp-server')}
          >
            <option value="tcp-client">Dial analyzer (it listens)</option>
            <option value="tcp-server">Listen (analyzer dials in)</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Order port</Label>
          <Input
            value={port}
            onChange={(e) => onPort(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
            inputMode="numeric"
            placeholder="e.g. 9161"
            autoComplete="off"
          />
        </div>
      </div>
      {transport === 'tcp-client' && (
        <div className="space-y-1.5">
          <Label>Analyzer Host / IP</Label>
          <Input
            value={host}
            onChange={(e) => onHost(e.target.value)}
            placeholder="e.g. 192.168.1.160"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}
    </div>
  )
}
