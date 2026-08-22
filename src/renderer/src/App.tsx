import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TopNav } from '@/components/layout/TopNav'
import { useAppStore } from '@/store/useAppStore'
import { pageTransition } from '@/lib/motion'
import { Dashboard } from '@/pages/Dashboard'
import { Instruments } from '@/pages/Instruments'
import { InstrumentDetail } from '@/pages/InstrumentDetail'
import { Discovery } from '@/pages/Discovery'
import { Mapping } from '@/pages/Mapping'
import { Monitor } from '@/pages/Monitor'
import { LisConnection } from '@/pages/LisConnection'
import { Logs } from '@/pages/Logs'
import { Settings } from '@/pages/Settings'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Waypoints } from 'lucide-react'

function Loading() {
  return (
    <div className="flex h-screen items-center justify-center">
      <motion.div
        className="flex flex-col items-center gap-4"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className="flex h-14 w-14 items-center justify-center rounded-3xl bg-secondary text-foreground"
          animate={{ opacity: [1, 0.55, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Waypoints className="h-6 w-6" strokeWidth={1.5} />
        </motion.div>
        <p className="text-sm font-light text-muted-foreground">Starting Stellar Synapse…</p>
      </motion.div>
    </div>
  )
}

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        variants={pageTransition}
        initial="hidden"
        animate="show"
        exit="exit"
        className="h-full"
      >
        {/* Keyed by path so an error on one page shows a recoverable fallback
            (the shell/sidebar stay alive) and navigating elsewhere clears it. */}
        <ErrorBoundary area="this view" resetKey={location.pathname}>
          <Routes location={location}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/instruments" element={<Instruments />} />
            <Route path="/instruments/:id" element={<InstrumentDetail />} />
            <Route path="/discovery" element={<Discovery />} />
            <Route path="/mapping" element={<Mapping />} />
            <Route path="/monitor" element={<Monitor />} />
            <Route path="/lis" element={<LisConnection />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </ErrorBoundary>
      </motion.div>
    </AnimatePresence>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-screen items-center justify-center p-8">
      <div className="max-w-md rounded-3xl bg-destructive/10 p-8 text-center">
        <p className="text-sm font-semibold text-destructive">Failed to start</p>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}

export default function App() {
  const ready = useAppStore((s) => s.ready)
  const error = useAppStore((s) => s.error)
  const init = useAppStore((s) => s.init)
  const theme = useAppStore((s) => s.settings?.theme)

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (theme) {
      document.documentElement.classList.toggle('dark', theme === 'dark')
      document.documentElement.classList.toggle('light', theme === 'light')
    }
  }, [theme])

  if (!ready) return <Loading />
  if (error) return <ErrorScreen message={error} />

  return (
    <HashRouter>
      <div className="flex h-screen flex-col overflow-hidden">
        <TopNav />
        <main className="flex-1 overflow-y-auto px-6 pb-8 pt-2">
          <div className="mx-auto max-w-[1500px]">
            <AnimatedRoutes />
          </div>
        </main>
      </div>
    </HashRouter>
  )
}
