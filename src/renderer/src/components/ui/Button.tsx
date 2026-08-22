import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'success'
type Size = 'sm' | 'md' | 'lg' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

/* Every control is a pill. Primary is the filled light pill of the reference;
   danger/success fill only on explicit destructive/confirming actions. */
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/85',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
  ghost: 'text-muted-foreground hover:bg-secondary hover:text-foreground',
  outline: 'border border-border bg-transparent text-foreground hover:bg-secondary',
  danger: 'bg-destructive/15 text-destructive hover:bg-destructive/25',
  success: 'bg-success/15 text-success hover:bg-success/25'
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-xs gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-11 px-6 text-sm gap-2',
  icon: 'h-9 w-9'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium transition-colors duration-200 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
)
Button.displayName = 'Button'
