import { cn } from '@/lib/utils'
import type { ConnectionStatus } from '@shared/types'

/* Status is the product: green = flowing, amber = trying, red = broken,
   listening = armed and waiting (accent), offline = a deliberate hollow ring —
   quiet, but still legible from across the lab. The label carries the tone
   too, so state survives even where the dot is the only mark. */
const map: Record<
  ConnectionStatus,
  { dot: string; ping?: string; text: string; label: string }
> = {
  online: { dot: 'bg-success', ping: 'bg-success', text: 'text-success', label: 'Online' },
  listening: { dot: 'bg-accent', ping: 'bg-accent', text: 'text-accent', label: 'Listening' },
  connecting: { dot: 'bg-warning', ping: 'bg-warning', text: 'text-warning', label: 'Connecting' },
  offline: {
    dot: 'border-[1.5px] border-muted-foreground bg-transparent',
    text: 'text-muted-foreground',
    label: 'Offline'
  },
  error: { dot: 'bg-destructive', text: 'text-destructive', label: 'Error' }
}

export function StatusDot({ status, showLabel = true }: { status: ConnectionStatus; showLabel?: boolean }) {
  const s = map[status]
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        {s.ping && (
          <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-50 animate-ping', s.ping)} />
        )}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', s.dot)} />
      </span>
      {showLabel && <span className={cn('text-xs font-medium', s.text)}>{s.label}</span>}
    </span>
  )
}
