import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Play, Square, Trash2, Cpu, Radio, ArrowRight, Pencil } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { StatusDot } from '@/components/ui/StatusDot'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { AddInstrumentModal } from '@/components/AddInstrumentModal'
import { EditInstrumentModal } from '@/components/EditInstrumentModal'
import { useAppStore } from '@/store/useAppStore'
import { cn, timeAgo } from '@/lib/utils'
import { fadeInUp, staggerContainer } from '@/lib/motion'
import type { InstrumentRuntime } from '@shared/types'

export function Instruments() {
  const instruments = useAppStore((s) => s.instruments)
  const drivers = useAppStore((s) => s.drivers)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<InstrumentRuntime | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const driverName = (id: string): string => drivers.find((d) => d.id === id)?.name ?? id

  const toggle = async (id: string, running: boolean): Promise<void> => {
    setBusy(id)
    try {
      if (running) await window.api.instruments.stop(id)
      else await window.api.instruments.start(id)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!confirm('Remove this instrument?')) return
    await window.api.instruments.remove(id)
  }

  return (
    <motion.div className="space-y-6" variants={staggerContainer} initial="hidden" animate="show">
      <motion.div className="flex items-center justify-between" variants={fadeInUp}>
        <p className="text-sm text-muted-foreground">
          {instruments.length} configured - {drivers.length} drivers available
        </p>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add Instrument
        </Button>
      </motion.div>

      <motion.div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" variants={staggerContainer}>
        <AnimatePresence>
        {instruments.map((inst) => {
          const running = inst.status === 'online' || inst.status === 'listening'
          return (
            <motion.div
              key={inst.id}
              layout
              variants={fadeInUp}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, scale: 0.95 }}
            >
            <Card
              interactive
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/instruments/${inst.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate(`/instruments/${inst.id}`)
                }
              }}
              className="group relative h-full cursor-pointer overflow-hidden"
            >
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-accent/10 text-primary">
                      <Cpu className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold leading-tight">{inst.name}</p>
                      <p className="text-xs text-muted-foreground">{driverName(inst.driverId)}</p>
                    </div>
                  </div>
                  <StatusDot status={inst.status} showLabel={false} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge tone="primary">{inst.protocol.toUpperCase()}</Badge>
                  <Badge tone="muted">
                    <Radio className="h-3 w-3" />
                    {inst.connection.transport === 'serial'
                      ? inst.connection.serialPath
                      : `:${inst.connection.port}`}
                  </Badge>
                  {inst.connection.hostQuery && <Badge tone="accent">Host Query</Badge>}
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-lg bg-secondary/30 p-3 text-center">
                  <div>
                    <p className="text-lg font-bold">
                      <AnimatedNumber value={inst.messagesReceived} />
                    </p>
                    <p className="text-[10px] uppercase text-muted-foreground">Messages</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-success">
                      <AnimatedNumber value={inst.resultsProcessed} />
                    </p>
                    <p className="text-[10px] uppercase text-muted-foreground">Results</p>
                  </div>
                  <div>
                    <p className={cn('text-lg font-bold', inst.errors > 0 && 'text-destructive')}>
                      <AnimatedNumber value={inst.errors} />
                    </p>
                    <p className="text-[10px] uppercase text-muted-foreground">Errors</p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Last msg {timeAgo(inst.lastMessageAt)}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant={running ? 'outline' : 'success'}
                      size="sm"
                      disabled={busy === inst.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggle(inst.id, running)
                      }}
                    >
                      {running ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {running ? 'Stop' : 'Start'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing(inst)
                      }}
                      title="Edit configuration"
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(inst.id)
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/instruments/${inst.id}`)
                      }}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            </motion.div>
          )
        })}
        </AnimatePresence>

        <motion.button
          variants={fadeInUp}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => setOpen(true)}
          className="group flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50 transition-transform duration-300 group-hover:scale-110 group-hover:bg-primary/15">
            <Plus className="h-6 w-6" />
          </div>
          <span className="text-sm font-medium">Add Instrument</span>
        </motion.button>
      </motion.div>

      <AddInstrumentModal open={open} onClose={() => setOpen(false)} />
      {editing && (
        <EditInstrumentModal open={!!editing} onClose={() => setEditing(null)} instrument={editing} />
      )}
    </motion.div>
  )
}
