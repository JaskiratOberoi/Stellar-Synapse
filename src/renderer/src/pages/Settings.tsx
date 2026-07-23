import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Zap,
  Beaker,
  Wand2,
  Info,
  Waypoints,
  Database,
  Power,
  MinusSquare,
  RefreshCw,
  DownloadCloud,
  RotateCw
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Label, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useAppStore } from '@/store/useAppStore'
import { fadeInUp, staggerContainer } from '@/lib/motion'
import type { AppSettings, LisConnectionSettings, UpdateStatus } from '@shared/types'

/** Human-readable label + tone for each updater state. */
function updateStateLabel(s: UpdateStatus): {
  text: string
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'muted'
} {
  switch (s.state) {
    case 'checking':
      return { text: 'Checking for updates…', tone: 'primary' }
    case 'available':
      return { text: `Update ${s.availableVersion ?? ''} found — downloading…`, tone: 'primary' }
    case 'downloading':
      return {
        text: `Downloading ${s.availableVersion ?? ''} (${s.progressPercent ?? 0}%)`,
        tone: 'primary'
      }
    case 'downloaded':
      return { text: `Update ${s.availableVersion ?? ''} ready to install`, tone: 'success' }
    case 'not-available':
      return { text: 'Up to date', tone: 'success' }
    case 'error':
      return { text: `Update error: ${s.error ?? 'unknown'}`, tone: 'danger' }
    case 'disabled':
      return { text: 'Auto-update off', tone: 'muted' }
    default:
      return { text: 'Idle', tone: 'muted' }
  }
}

export function Settings() {
  const settings = useAppStore((s) => s.settings)
  const lisSettings = useAppStore((s) => s.lisSettings)
  const setSettings = useAppStore((s) => s.setSettings)
  const drivers = useAppStore((s) => s.drivers)
  const [form, setForm] = useState<AppSettings | null>(settings)
  const [lisForm, setLisForm] = useState<LisConnectionSettings | null>(lisSettings)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => setForm(settings), [settings])
  useEffect(() => setLisForm(lisSettings), [lisSettings])
  useEffect(() => {
    void window.api.update.getStatus().then(setUpdateStatus)
    return window.api.update.onStatus(setUpdateStatus)
  }, [])
  if (!form || !lisForm) return null

  const apply = async (patch: Partial<AppSettings>): Promise<void> => {
    const next = { ...form, ...patch }
    setForm(next)
    const saved = await window.api.settings.save(patch)
    setSettings(saved)
  }

  const applyLis = async (patch: Partial<LisConnectionSettings>): Promise<void> => {
    const next = { ...lisForm, ...patch }
    setLisForm(next)
    const saved = await window.api.lis.saveSettings(next)
    useAppStore.setState({ lisSettings: saved })
  }

  return (
    <motion.div
      className="max-w-3xl space-y-6"
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={fadeInUp}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Power className="h-4 w-4" /> Background &amp; Startup
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Stellar Synapse runs as a background service so machine interfacing never stops by
              accident.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Start automatically on system startup</p>
                <p className="text-xs text-muted-foreground">
                  Launch hidden in the system tray at login so interfacing resumes after a reboot
                </p>
              </div>
              <Switch
                checked={form.launchAtStartup}
                onChange={(v) => apply({ launchAtStartup: v })}
              />
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3">
              <MinusSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-xs text-muted-foreground">
                Closing the window with the <span className="font-medium text-foreground">✕</span>{' '}
                button keeps the app running in the system tray — interfacing continues. To fully
                stop it, right-click the tray icon and choose{' '}
                <span className="font-medium text-foreground">Quit Stellar Synapse</span>.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

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
              <Switch
                checked={form.simulatorEnabled}
                onChange={(v) => apply({ simulatorEnabled: v })}
              />
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
              <Database className="h-4 w-4" /> LIS Integration (Noble)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Live connection writes HbA1c and eAG from the LD-560 into Noble by sample barcode
              (vailid). Set the SQL password under LIS Connection if not already saved.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-destructive">Live LIS connection</p>
                <p className="text-xs text-muted-foreground">
                  Connect to Noble SQL Server ({lisForm.server}:{lisForm.port})
                </p>
              </div>
              <Switch checked={lisForm.live} onChange={(v) => applyLis({ live: v })} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Auto-write HbA1c to LIS</p>
                <p className="text-xs text-muted-foreground">
                  Propagate new LD-560 results to Noble as they arrive (barcode must exist in LIS)
                </p>
              </div>
              <Switch
                checked={form.lisAutoWrite}
                onChange={(v) => apply({ lisAutoWrite: v })}
                disabled={!lisForm.live}
              />
            </div>

            {!lisForm.live && (
              <p className="text-xs text-warning">
                Live LIS is off — results are stored locally only. Enable live connection to write
                to Noble.
              </p>
            )}
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
              <Switch
                checked={form.autoMapOnReceive}
                onChange={(v) => apply({ autoMapOnReceive: v })}
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DownloadCloud className="h-4 w-4" /> Software Updates
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Stellar Synapse updates itself over the air. New versions download in the background
              and install automatically overnight so every lab site stays current without a manual
              reinstall.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Automatic updates</p>
                <p className="text-xs text-muted-foreground">
                  Check for, download, and install new versions automatically
                </p>
              </div>
              <Switch
                checked={form.autoUpdateEnabled}
                onChange={(v) => apply({ autoUpdateEnabled: v })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Install downloaded updates at</Label>
              <Select
                value={String(form.updateInstallHour)}
                onChange={(e) => apply({ updateInstallHour: Number(e.target.value) })}
                disabled={!form.autoUpdateEnabled}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00 (local)
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Off-hours is safest — the app restarts to apply the update, then interfacing
                resumes.
              </p>
            </div>

            {updateStatus && (
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={updateStateLabel(updateStatus).tone}>
                      {updateStateLabel(updateStatus).text}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Current version v{updateStatus.currentVersion}
                    {updateStatus.pendingInstallAt && updateStatus.state === 'downloaded'
                      ? ` · installs ${new Date(updateStatus.pendingInstallAt).toLocaleString()}`
                      : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {updateStatus.state === 'downloaded' ? (
                    <Button onClick={() => void window.api.update.install()}>
                      <RotateCw className="h-4 w-4" /> Restart &amp; install
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={
                        !form.autoUpdateEnabled ||
                        updateStatus.state === 'checking' ||
                        updateStatus.state === 'downloading'
                      }
                      onClick={() => void window.api.update.check()}
                    >
                      <RefreshCw className="h-4 w-4" /> Check now
                    </Button>
                  )}
                </div>
              </div>
            )}
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
                  LIS Instrument Integration Middleware · v
                  {updateStatus?.currentVersion ?? __APP_VERSION__}
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
