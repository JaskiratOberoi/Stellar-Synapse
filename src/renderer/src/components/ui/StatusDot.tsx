import { cn } from '@/lib/utils'
import type { ConnectionStatus } from '@shared/types'

const map: Record<ConnectionStatus, { color: string; glow: string; label: string; pulse?: boolean }> = {
  online: { color: 'bg-success', glow: 'shadow-success', label: 'Online', pulse: true },
  listening: { color: 'bg-accent', glow: 'shadow-accent', label: 'Listening', pulse: true },
  connecting: { color: 'bg-warning', glow: 'shadow-warning', label: 'Connecting', pulse: true },
  offline: { color: 'bg-muted-foreground/50', glow: '', label: 'Offline' },
  error: { color: 'bg-destructive', glow: 'shadow-destructive', label: 'Error' }
}

export function StatusDot({ status, showLabel = true }: { status: ConnectionStatus; showLabel?: boolean }) {
  const s = map[status]
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        {s.pulse && (
          <span
            className={cn('absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping', s.color)}
          />
        )}
        <span
          className={cn(
            'relative inline-flex h-2.5 w-2.5 rounded-full transition-shadow',
            s.color,
            s.pulse && `shadow-[0_0_8px_1px] ${s.glow}`
          )}
        />
      </span>
      {showLabel && <span className="text-xs font-medium text-muted-foreground">{s.label}</span>}
    </span>
  )
}
