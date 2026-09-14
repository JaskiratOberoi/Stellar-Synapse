import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Chromatogram picture an analyzer embedded in a result frame (LD-560 "Base 64"
 * picture mode). The PNG lives on disk under the app data folder; it is fetched
 * lazily from the main process as a data: URL so the renderer never touches the
 * filesystem directly.
 */
export function ChromatogramImage({
  file,
  className,
  showPath = false
}: {
  file: string
  className?: string
  showPath?: boolean
}) {
  const [src, setSrc] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    setSrc(undefined)
    window.api.monitor
      .image(file)
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null))
    return () => {
      alive = false
    }
  }, [file])
  return (
    <div className={className}>
      {src === undefined && <p className="text-xs text-muted-foreground">Loading picture...</p>}
      {src === null && <p className="text-xs text-warning">Picture file is missing on disk.</p>}
      {src && (
        <img
          src={src}
          alt="Chromatogram"
          className={cn('w-full rounded-2xl border border-border bg-white')}
        />
      )}
      {showPath && (
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={file}>
          {file}
        </p>
      )}
    </div>
  )
}
