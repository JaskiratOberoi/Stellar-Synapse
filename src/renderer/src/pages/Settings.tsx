import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Zap, Beaker, Wand2, Info, Waypoints } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Label, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useAppStore } from '@/store/useAppStore'
import { fadeInUp, staggerContainer } from '@/lib/motion'
import type { AppSettings } from '@shared/types'

export function Settings() {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const drivers = useAppStore((s) => s.drivers)
  const [form, setForm] = useState<AppSettings | null>(settings)

  useEffect(() => setForm(settings), [settings])
  if (!form) return null

  const apply = async (patch: Partial<AppSettings>): Promise<void> => {
    const next = { ...form, ...patch }
    setForm(next)
    const saved = await window.api.settings.save(patch)
    setSettings(saved)
  }

  return (
    <motion.div className="max-w-3xl space-y-6" variants={staggerContainer} initial="hidden" animate="show">
      <motion.div variants={fadeInUp}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Beaker className="h-4 w-4" /> Instrument Simulator
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Generates realistic ASTM/HL7 traffic for active instruments so the app can be reviewed
            without physical hardware.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Enable simulator</p>
              <p className="text-xs text-muted-foreground">Emit synthetic results on a timer</p>
            </div>
            <Switch checked={form.simulatorEnabled} onChange={(v) => apply({ simulatorEnabled: v })} />
          </div>

          <div className="space-y-1.5">
            <Label>Emission rate (per minute, per instrument)</Label>
            <Select
              value={String(form.simulatorRate)}
              onChange={(e) => apply({ simulatorRate: Number(e.target.value) })}
            >
              {[3, 6, 12, 20, 30].map((r) => (
                <option key={r} value={r}>
                  {r} samples / min
                </option>
              ))}
            </Select>
          </div>

          <Button variant="outline" onClick={() => window.api.simulator.emitOne()}>
            <Zap className="h-4 w-4" /> Emit one sample now
          </Button>
        </CardContent>
      </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" /> Mapping
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Auto-map on receive</p>
              <p className="text-xs text-muted-foreground">
                Attempt to resolve unmapped analytes as results arrive
              </p>
            </div>
            <Switch checked={form.autoMapOnReceive} onChange={(v) => apply({ autoMapOnReceive: v })} />
          </div>
        </CardContent>
      </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-4 w-4" /> About
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent">
              <Waypoints className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="font-semibold">Stellar Synapse</p>
              <p className="text-xs text-muted-foreground">
                LIS Instrument Integration Middleware - v0.1.0 (scaffold)
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs uppercase text-muted-foreground">Registered drivers</p>
            <div className="flex flex-wrap gap-2">
              {drivers.map((d) => (
                <Badge key={d.id} tone="primary">
                  {d.name}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      </motion.div>
    </motion.div>
  )
}
