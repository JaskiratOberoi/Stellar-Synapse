import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Tone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'accent' | 'muted'

/* Pill chips; tinted fill only, no tinted borders — the reference keeps edges quiet. */
const tones: Record<Tone, string> = {
  default: 'bg-secondary text-secondary-foreground',
  primary: 'bg-primary/10 text-foreground',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/15 text-destructive',
  accent: 'bg-accent/15 text-accent',
  muted: 'bg-muted text-muted-foreground'
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

export function Badge({ className, tone = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-200',
        tones[tone],
        className
      )}
      {...props}
    />
  )
}
