import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { spring } from '@/lib/motion'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/* On = filled light, knob goes dark — monochrome state, no tint spent on it. */
export function Switch({ checked, onChange, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50',
        checked ? 'bg-foreground' : 'bg-muted'
      )}
    >
      <motion.span
        animate={{ x: checked ? 22 : 2 }}
        transition={spring}
        className={cn(
          'inline-block h-5 w-5 rounded-full shadow transition-colors duration-200',
          checked ? 'bg-background' : 'bg-foreground/80'
        )}
      />
    </button>
  )
}
