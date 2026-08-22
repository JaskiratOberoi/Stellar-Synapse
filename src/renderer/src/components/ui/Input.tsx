import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/* Soft filled fields — no hard outlines until focus, matching the plate language. */
const fieldClasses =
  'h-10 w-full rounded-2xl border border-transparent bg-input px-4 text-sm text-foreground outline-none transition-all duration-200 placeholder:text-muted-foreground/70 hover:bg-muted focus:border-foreground/25 focus:bg-card focus:ring-2 focus:ring-ring/25 disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldClasses, className)} {...props} />
  )
)
Input.displayName = 'Input'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(fieldClasses, 'appearance-none pr-8', className)} {...props}>
      {children}
    </select>
  )
)
Select.displayName = 'Select'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('microlabel', className)} {...props} />
}
