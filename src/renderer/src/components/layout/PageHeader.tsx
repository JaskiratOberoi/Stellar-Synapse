import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Right-aligned actions (buttons, filters). */
  children?: ReactNode
  className?: string
}

/**
 * Page headline in the display voice: large, light, tracking-tight — the page
 * introduces itself, the chrome does not. Actions sit on the same baseline.
 */
export function PageHeader({ title, subtitle, children, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div>
        <h1 className="text-4xl font-extralight tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}
