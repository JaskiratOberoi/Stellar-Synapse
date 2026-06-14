import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Database, ShieldAlert, CheckCircle2, XCircle, Loader2, Save } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Switch } from '@/components/ui/Switch'
import { useAppStore } from '@/store/useAppStore'
import type { LisConnectionResult, LisConnectionSettings } from '@shared/types'
import { formatTime } from '@/lib/utils'
import { ease, fadeInUp, listItem, spring, staggerContainer } from '@/lib/motion'

export function LisConnection() {
  const stored = useAppStore((s) => s.lisSettings)
  const writes = useAppStore((s) => s.monitor) // for recent writes count
  const [form, setForm] = useState<LisConnectionSettings | null>(stored)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<LisConnectionResult | null>(null)
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof window.api.lis.recentWrites>>>([])

  useEffect(() => setForm(stored), [stored])
  useEffect(() => {
    window.api.lis.recentWrites().then(setRecent)
    const t = setInterval(() => window.api.lis.recentWrites().then(setRecent), 3000)
    return () => clearInterval(t)
  }, [writes])

  if (!form) return null

  const update = (patch: Partial<LisConnectionSettings>): void => setForm({ ...form, ...patch })

  const test = async (): Promise<void> => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await window.api.lis.testConnection(form))
    } finally {
      setTesting(false)
    }
  }

  const save = async (): Promise<void> => {
    await window.api.lis.saveSettings(form)
  }

  return (
    <motion.div className="max-w-4xl space-y-6" variants={staggerContainer} initial="hidden" animate="show">
      <AnimatePresence>
      {!form.live && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={ease}
          className="flex items-start gap-3 overflow-hidden rounded-xl border border-warning/30 bg-warning/10 p-4"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-semibold text-warning">Mock mode active</p>
            <p className="text-muted-foreground">
              The configured target is the production Noble database. In this scaffold phase, live
              writes are disabled and results are recorded to an in-memory buffer. Enable Live Mode
              only when you are ready to write to SQL Server.
            </p>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      <motion.div className="grid gap-6 lg:grid-cols-2" variants={staggerContainer}>
        <motion.div variants={fadeInUp}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4" /> Noble SQL Server
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Server</Label>
              <Input value={form.server} onChange={(e) => update({ server: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Database</Label>
                <Input value={form.database} onChange={(e) => update({ database: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Port</Label>
                <Input
                  type="number"
                  value={form.port}
                  onChange={(e) => update({ port: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>User</Label>
                <Input value={form.user} onChange={(e) => update({ user: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={form.password}
                  placeholder="(not stored in scaffold)"
                  onChange={(e) => update({ password: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Encrypt connection</p>
                <p className="text-xs text-muted-foreground">TLS to SQL Server</p>
              </div>
              <Switch checked={form.encrypt} onChange={(v) => update({ encrypt: v })} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-destructive">Live Mode</p>
                <p className="text-xs text-muted-foreground">Enable real reads/writes to Noble</p>
              </div>
              <Switch checked={form.live} onChange={(v) => update({ live: v })} />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={test} disabled={testing} className="flex-1">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                Test Connection
              </Button>
              <Button onClick={save} className="flex-1">
                <Save className="h-4 w-4" /> Save
              </Button>
            </div>

            <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={spring}
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                  result.state === 'connected'
                    ? 'border-success/30 bg-success/10'
                    : result.state === 'error'
                      ? 'border-destructive/30 bg-destructive/10'
                      : 'border-warning/30 bg-warning/10'
                }`}
              >
                {result.state === 'connected' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
                ) : result.state === 'error' ? (
                  <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                ) : (
                  <ShieldAlert className="mt-0.5 h-4 w-4 text-warning" />
                )}
                <div>
                  <p className="font-medium capitalize">{result.state}</p>
                  <p className="text-xs text-muted-foreground">{result.message}</p>
                </div>
              </motion.div>
            )}
            </AnimatePresence>
          </CardContent>
        </Card>
        </motion.div>

        <motion.div variants={fadeInUp}>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent LIS Writes</CardTitle>
            <Badge tone="muted">{recent.length}</Badge>
          </CardHeader>
          <CardContent>
            <div className="max-h-[460px] space-y-1 overflow-y-auto">
              <AnimatePresence initial={false}>
              {recent.map((w, i) => (
                <motion.div
                  key={`${w.vailid}-${w.testCode}-${w.addedDate}-${i}`}
                  layout
                  variants={listItem}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  className="flex items-center justify-between rounded-lg border border-border/40 bg-secondary/20 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      <span className="font-mono text-accent">{w.vailid}</span> {w.testCode}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {w.machineName} - {formatTime(w.addedDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">
                      {w.value} <span className="text-xs text-muted-foreground">{w.unit}</span>
                    </p>
                    {w.abnormal && <Badge tone="danger">abnormal</Badge>}
                  </div>
                </motion.div>
              ))}
              </AnimatePresence>
              {recent.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No results written yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
