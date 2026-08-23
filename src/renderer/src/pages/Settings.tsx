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
  RotateCw,
  Cloud,
  CheckCircle2,
  XCircle,
  Loader2
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Input, Label, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/layout/PageHeader'
import { useAppStore } from '@/store/useAppStore'
import { fadeInUp, staggerContainer } from '@/lib/motion'
import type {
  AppSettings,
  CloudSyncStatus,
  CloudTestResult,
  LisConnectionSettings,
  UpdateStatus
} from '@shared/types'

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

/** Human-readable label + tone for the cloud sync status line. */
function cloudStateLabel(s: CloudSyncStatus): {
  text: string
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'muted'
} {
  if (!s.enabled) return { text: 'Cloud sync off', tone: 'muted' }
  if (!s.configured) return { text: 'Not configured', tone: 'warning' }
  if (s.lastError) return { text: `Sync error: ${s.lastError}`, tone: 'danger' }
  if (s.lastSuccessAt) {
    return { text: `Last sync ${new Date(s.lastSuccessAt).toLocaleString()}`, tone: 'success' }
  }
  return { text: 'Waiting for first sync…', tone: 'primary' }
}

export function Settings() {
  const settings = useAppStore((s) => s.settings)
  const lisSettings = useAppStore((s) => s.lisSettings)
  const setSettings = useAppStore((s) => s.setSettings)
  const drivers = useAppStore((s) => s.drivers)
  const [form, setForm] = useState<AppSettings | null>(settings)
  const [lisForm, setLisForm] = useState<LisConnectionSettings | null>(lisSettings)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus | null>(null)
  const [cloudTesting, setCloudTesting] = useState(false)
  const [cloudTest, setCloudTest] = useState<CloudTestResult | null>(null)

  useEffect(() => setForm(settings), [settings])
  useEffect(() => setLisForm(lisSettings), [lisSettings])
  useEffect(() => {
    void window.api.update.getStatus().then(setUpdateStatus)
    return window.api.update.onStatus(setUpdateStatus)
  }, [])
  useEffect(() => {
    void window.api.cloud.status().then(setCloudStatus)
    return window.api.cloud.onStatus(setCloudStatus)
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

  /** Update a text field locally while typing; commitField saves it on blur. */
  const editField = (patch: Partial<AppSettings>): void => setForm({ ...form, ...patch })
  const commitField = (key: keyof AppSettings): void => {
    if (settings && form[key] !== settings[key]) {
      void apply({ [key]: form[key] } as Partial<AppSettings>)
    }
  }

  const testCloud = async (): Promise<void> => {
    setCloudTesting(true)
    setCloudTest(null)
    try {
      setCloudTest(
        await window.api.cloud.test(
          form.infinityBaseUrl,
          form.infinitySiteCode,
          form.infinitySiteKey
        )
      )
    } finally {
      setCloudTesting(false)
    }
  }

  return (
    <motion.div
      className="mx-auto w-full max-w-[1500px] pb-4"
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={fadeInUp}>
        <PageHeader title="Settings" subtitle="Application preferences" />
      </motion.div>

      {/* Split by what the operator came here to do. The two columns hold the
          settings that get changed during setup and troubleshooting — the systems
          Synapse talks to, and how the app itself behaves — and carry near-equal
          weight (~830px vs ~765px of content), so neither leaves a void beside the
          other. Independent stacks, not grid rows: card heights are uneven and
          nothing should stretch to match a neighbour. One column below lg, which
          is where a half-width lab window lands. */}
      <div className="mt-8 grid items-start gap-x-6 gap-y-12 lg:grid-cols-2">
        <section className="space-y-4">
          <motion.div variants={fadeInUp} className="microlabel px-1 text-muted-foreground">
            Connections
          </motion.div>
          <motion.div variants={fadeInUp}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-4 w-4" strokeWidth={1.75} /> LIS Integration (Noble)
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Live connection writes HbA1c and eAG from the LD-560 into Noble by sample barcode
                  (vailid). Set the SQL password under LIS Connection if not already saved.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-2xl bg-destructive/10 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-destructive">Live LIS connection</p>
                    <p className="text-xs text-muted-foreground">
                      Connect to Noble SQL Server ({lisForm.server}:{lisForm.port})
                    </p>
                  </div>
                  <Switch checked={lisForm.live} onChange={(v) => applyLis({ live: v })} />
                </div>
    
                <div className="flex items-center justify-between rounded-2xl bg-secondary/40 px-4 py-3">
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
                  <Cloud className="h-4 w-4" strokeWidth={1.75} /> Stellar Infinity Cloud
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Push live instrument status and daily statistics to the Stellar Infinity platform so
                  every lab site can be monitored centrally. Interfacing is never affected by cloud
                  connectivity.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-2xl bg-secondary/40 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Enable cloud sync</p>
                    <p className="text-xs text-muted-foreground">
                      Report instrument status and stats to Stellar Infinity in near-realtime
                    </p>
                  </div>
                  <Switch
                    checked={form.infinityEnabled}
                    onChange={(v) => apply({ infinityEnabled: v })}
                  />
                </div>
    
                <div className="space-y-1.5">
                  <Label>Base URL</Label>
                  <Input
                    value={form.infinityBaseUrl}
                    placeholder="https://infinity.example.com"
                    onChange={(e) => editField({ infinityBaseUrl: e.target.value })}
                    onBlur={() => commitField('infinityBaseUrl')}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Site code</Label>
                    <Input
                      value={form.infinitySiteCode}
                      onChange={(e) => editField({ infinitySiteCode: e.target.value })}
                      onBlur={() => commitField('infinitySiteCode')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Site key</Label>
                    <Input
                      type="password"
                      value={form.infinitySiteKey}
                      onChange={(e) => editField({ infinitySiteKey: e.target.value })}
                      onBlur={() => commitField('infinitySiteKey')}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Lab name</Label>
                    <Input
                      value={form.labName}
                      onChange={(e) => editField({ labName: e.target.value })}
                      onBlur={() => commitField('labName')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Lab location</Label>
                    <Input
                      value={form.labLocation}
                      onChange={(e) => editField({ labLocation: e.target.value })}
                      onBlur={() => commitField('labLocation')}
                    />
                  </div>
                </div>
    
                <Button variant="secondary" onClick={testCloud} disabled={cloudTesting}>
                  {cloudTesting ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <Cloud className="h-4 w-4" strokeWidth={1.75} />
                  )}
                  Test connection
                </Button>
    
                {cloudTest && (
                  <div
                    className={`flex items-start gap-2 rounded-2xl p-3 text-sm ${
                      cloudTest.ok ? 'bg-success/10' : 'bg-destructive/10'
                    }`}
                  >
                    {cloudTest.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" strokeWidth={1.75} />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 text-destructive" strokeWidth={1.75} />
                    )}
                    <p className="text-xs text-muted-foreground">
                      {cloudTest.ok
                        ? `Connected as ${cloudTest.siteName ?? 'unknown site'}`
                        : (cloudTest.error ?? 'Connection failed')}
                    </p>
                  </div>
                )}
    
                {cloudStatus && (
                  <div className="flex items-center justify-between rounded-2xl bg-secondary/40 px-4 py-3">
                    <div className="space-y-1">
                      <Badge tone={cloudStateLabel(cloudStatus).tone}>
                        {cloudStateLabel(cloudStatus).text}
                      </Badge>
                      {cloudStatus.lastAttemptAt && (
                        <p className="text-xs text-muted-foreground">
                          Last attempt {new Date(cloudStatus.lastAttemptAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </section>

        <section className="space-y-4">
          <motion.div variants={fadeInUp} className="microlabel px-1 text-muted-foreground">
            Application
          </motion.div>
          <motion.div variants={fadeInUp}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Power className="h-4 w-4" strokeWidth={1.75} /> Background &amp; Startup
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Stellar Synapse runs as a background service so machine interfacing never stops by
                  accident.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-2xl bg-secondary/40 px-4 py-3">
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
    
                <div className="flex items-start gap-2 rounded-2xl bg-secondary/40 px-4 py-3">
                  <MinusSquare className="mt-0.5 h-4 w-4 shrink-0 text-foreground" strokeWidth={1.75} />
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
                  <DownloadCloud className="h-4 w-4" strokeWidth={1.75} /> Software Updates
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Stellar Synapse updates itself over the air. New versions download in the background
                  and install automatically overnight so every lab site stays current without a manual
                  reinstall.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-2xl bg-secondary/40 px-4 py-3">
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
                  <div className="flex items-center justify-between rounded-2xl bg-secondary/40 px-4 py-3">
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
                          <RotateCw className="h-4 w-4" strokeWidth={1.75} /> Restart &amp; install
                        </Button>
                      ) : (
                        <>
                          {/* Deliberately NOT gated on autoUpdateEnabled: these are
                              explicit operator actions, not the background schedule. */}
                          <Button
                            variant="outline"
                            disabled={
                              updateStatus.state === 'checking' || updateStatus.state === 'downloading'
                            }
                            onClick={() => void window.api.update.check()}
                          >
                            <RefreshCw className="h-4 w-4" strokeWidth={1.75} /> Check now
                          </Button>
                          <Button
                            disabled={
                              updateStatus.state === 'checking' || updateStatus.state === 'downloading'
                            }
                            onClick={() => void window.api.update.now()}
                          >
                            <RotateCw className="h-4 w-4" strokeWidth={1.75} /> Update now
                          </Button>
                        </>
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
                  <Wand2 className="h-4 w-4" strokeWidth={1.75} /> Mapping
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between rounded-2xl bg-secondary/40 px-4 py-3">
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
        </section>
      </div>

      {/* Occasional and read-only: a demo aid and a spec sheet. Set apart in a
          lighter band below the working columns rather than padding one of them
          out — the separation is the point, and it keeps the two columns even. */}
      <div className="mt-12 space-y-4">
        <motion.div variants={fadeInUp} className="microlabel px-1 text-muted-foreground">
          Tools & reference
        </motion.div>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <motion.div variants={fadeInUp}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Beaker className="h-4 w-4" strokeWidth={1.75} /> Instrument Simulator
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Generates realistic ASTM/HL7 traffic for active instruments so the app can be reviewed
                  without physical hardware.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-2xl bg-secondary/40 px-4 py-3">
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
                  <Zap className="h-4 w-4" strokeWidth={1.75} /> Emit one sample now
                </Button>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div variants={fadeInUp}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="h-4 w-4" strokeWidth={1.75} /> About
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-foreground">
                    <Waypoints className="h-6 w-6" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="font-medium">Stellar Synapse</p>
                    <p className="text-xs text-muted-foreground">
                      LIS Instrument Integration Middleware · v
                      {updateStatus?.currentVersion ?? __APP_VERSION__}
                    </p>
                  </div>
                </div>
    
                <div>
                  <p className="microlabel mb-2">Registered drivers</p>
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
        </div>
      </div>
    </motion.div>
  )
}
