import { type ReactNode, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ease } from '@/lib/motion'
import { Button } from './Button'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}

/* The frosted command layer — the one place glass is spent, per the reference. */
export function Modal({ open, onClose, title, description, children, footer, className }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-background/70 backdrop-blur-md"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn('frost relative z-10 w-full max-w-lg rounded-3xl shadow-2xl shadow-black/50', className)}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={ease}
          >
            <div className="flex items-start justify-between p-6 pb-4">
              <div>
                <h2 className="text-2xl font-extralight tracking-tight">{title}</h2>
                {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} title="Close">
                <X className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto px-6 pb-6">{children}</div>
            {footer && (
              <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
