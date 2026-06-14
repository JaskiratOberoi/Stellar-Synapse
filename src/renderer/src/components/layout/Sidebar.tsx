import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Cpu,
  Network,
  Activity,
  Database,
  ScrollText,
  Settings,
  Waypoints,
  Radar
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { spring } from '@/lib/motion'
import { useAppStore } from '@/store/useAppStore'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/instruments', label: 'Instruments', icon: Cpu },
  { to: '/discovery', label: 'Discovery', icon: Radar },
  { to: '/mapping', label: 'Mapping', icon: Network },
  { to: '/monitor', label: 'Live Monitor', icon: Activity },
  { to: '/lis', label: 'LIS Connection', icon: Database },
  { to: '/logs', label: 'Logs', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings }
]

export function Sidebar() {
  const instruments = useAppStore((s) => s.instruments)
  const online = instruments.filter((i) => i.status === 'online' || i.status === 'listening').length

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border/60 bg-card/40">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/30 transition-transform hover:scale-105">
          <Waypoints className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-bold leading-tight tracking-tight">Stellar Synapse</div>
          <div className="text-[11px] text-muted-foreground">LIS Middleware</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="sidebar-active"
                    transition={spring}
                    className="absolute inset-0 rounded-lg bg-primary/15 shadow-sm"
                  />
                )}
                <item.icon className="relative z-10 h-[18px] w-[18px] transition-transform duration-200 group-hover:scale-110" />
                <span className="relative z-10">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border/60 p-4">
        <div className="rounded-lg bg-secondary/50 px-3 py-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Instruments online</span>
            <span className="font-semibold text-foreground">
              <AnimatedNumber value={online} />/{instruments.length}
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
