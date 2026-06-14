import { useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Moon, Sun, Database, Zap, ZapOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useAppStore } from '@/store/useAppStore'
import { useEffect, useState } from 'react'

const titles: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Live overview of instruments and result throughput' },
  '/instruments': { title: 'Instruments', subtitle: 'Configure and control connected analyzers' },
  '/discovery': { title: 'Network Discovery', subtitle: 'Read-only scan for instruments on your LAN' },
  '/mapping': { title: 'Parameter Mapping', subtitle: 'Map instrument analytes to Noble LIS tests' },
  '/monitor': { title: 'Live Monitor', subtitle: 'Real-time decoded result stream' },
  '/lis': { title: 'LIS Connection', subtitle: 'Noble SQL Server database configuration' },
  '/logs': { title: 'Logs', subtitle: 'System and protocol activity log' },
  '/settings': { title: 'Settings', subtitle: 'Application and simulator preferences' }
}

export function Topbar() {
  const { pathname } = useLocation()
  const meta = titles[pathname] ?? { title: 'Stellar Synapse', subtitle: '' }
  const settings = useAppStore((s) => s.settings)
  const stats = useAppStore((s) => s.stats)
  const [theme, setTheme] = useState<'dark' | 'light'>(settings?.theme ?? 'dark')
  const [simOn, setSimOn] = useState(settings?.simulatorEnabled ?? true)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  useEffect(() => {
    if (settings) {
      setTheme(settings.theme)
      setSimOn(settings.simulatorEnabled)
    }
  }, [settings])

  const toggleTheme = async (): Promise<void> => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    const saved = await window.api.settings.save({ theme: next })
    useAppStore.getState().setSettings(saved)
  }

  const toggleSim = async (): Promise<void> => {
    const next = !simOn
    setSimOn(next)
    const saved = await window.api.settings.save({ simulatorEnabled: next })
    useAppStore.getState().setSettings(saved)
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 bg-card/30 px-6">
      <AnimatePresence mode="wait">
        <motion.div
          key={pathname}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 8 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1 className="text-lg font-semibold tracking-tight">{meta.title}</h1>
          <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
        </motion.div>
      </AnimatePresence>

      <div className="flex items-center gap-3">
        <Badge tone={stats?.lisState === 'connected' ? 'success' : 'warning'}>
          <Database className="h-3 w-3" />
          {stats?.lisState === 'connected' ? 'LIS Connected' : 'LIS Mock Mode'}
        </Badge>

        <Button
          variant={simOn ? 'success' : 'outline'}
          size="sm"
          onClick={toggleSim}
          title="Toggle instrument simulator"
        >
          <motion.span
            key={simOn ? 'on' : 'off'}
            initial={{ rotate: -30, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="inline-flex"
          >
            {simOn ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
          </motion.span>
          {simOn ? 'Simulator On' : 'Simulator Off'}
        </Button>

        <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle theme">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={theme}
              initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.25 }}
              className="inline-flex"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </motion.span>
          </AnimatePresence>
        </Button>
      </div>
    </header>
  )
}
