import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Moon, Sun, Database, Cloud, CloudOff, Waypoints } from 'lucide-react'
import { cn } from '@/lib/utils'
import { spring } from '@/lib/motion'
import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/Button'

const nav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/instruments', label: 'Instruments' },
  { to: '/discovery', label: 'Discovery' },
  { to: '/mapping', label: 'Mapping' },
  { to: '/monitor', label: 'Monitor' },
  { to: '/lis', label: 'LIS' },
  { to: '/logs', label: 'Logs' },
  { to: '/settings', label: 'Settings' }
]

export function TopNav() {
  const settings = useAppStore((s) => s.settings)
  const stats = useAppStore((s) => s.stats)
  const cloud = useAppStore((s) => s.cloudStatus)
  const [theme, setTheme] = useState<'dark' | 'light'>(settings?.theme ?? 'dark')

  // This host's LAN IPv4 — the address analyzers connect to. Readable straight
  // off the machine during onboarding.
  const [lanIp, setLanIp] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.api.system
      .lanIp()
      .then((ip) => {
        if (alive) setLanIp(ip)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  useEffect(() => {
    if (settings) setTheme(settings.theme)
  }, [settings])

  const toggleTheme = async (): Promise<void> => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    const saved = await window.api.settings.save({ theme: next })
    useAppStore.getState().setSettings(saved)
  }

  const lisConnected = stats?.lisState === 'connected'
  const cloudOn = cloud?.enabled && cloud?.configured

  return (
    <header className="flex h-[72px] shrink-0 items-center gap-6 px-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-secondary text-foreground">
          <Waypoints className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-medium tracking-tight">Stellar Synapse</div>
          <div className="microlabel">Interfacing</div>
        </div>
      </div>

      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'relative whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                isActive
                  ? 'font-medium text-foreground'
                  : 'font-normal text-muted-foreground hover:text-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="nav-active"
                    transition={spring}
                    className="absolute inset-0 rounded-full bg-secondary"
                  />
                )}
                <span className="relative z-10">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-2">
        <NavLink
          to="/lis"
          title={lisConnected ? 'Noble LIS connected' : 'LIS in mock mode'}
          className="flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Database className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className={cn('h-1.5 w-1.5 rounded-full', lisConnected ? 'bg-success' : 'bg-warning')} />
          <span className="hidden xl:inline">{lisConnected ? 'LIS live' : 'LIS mock'}</span>
        </NavLink>

        <NavLink
          to="/settings"
          title={
            cloudOn
              ? cloud?.lastError
                ? `Cloud sync error: ${cloud.lastError}`
                : 'Cloud sync active'
              : 'Cloud sync off'
          }
          className="flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {cloudOn ? (
            <Cloud className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <CloudOff className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {cloudOn && (
            <span
              className={cn('h-1.5 w-1.5 rounded-full', cloud?.lastError ? 'bg-destructive' : 'bg-success')}
            />
          )}
        </NavLink>

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
              {theme === 'dark' ? (
                <Sun className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Moon className="h-4 w-4" strokeWidth={1.75} />
              )}
            </motion.span>
          </AnimatePresence>
        </Button>

        <div
          className="hidden text-right leading-tight 2xl:block"
          title="App version · this machine's LAN IPv4 (what analyzers dial)"
        >
          <div className="text-[11px] tabular-nums text-muted-foreground">v{__APP_VERSION__}</div>
          {lanIp && <div className="font-mono text-[11px] text-muted-foreground">{lanIp}</div>}
        </div>
      </div>
    </header>
  )
}
