import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** When this value changes, a caught error is cleared (e.g. on route change). */
  resetKey?: string | number
  /** Label for the area that failed (shown in the fallback). */
  area?: string
}

interface State {
  error: Error | null
}

/**
 * Catches render/lifecycle errors in its subtree and shows a recoverable
 * fallback instead of letting React 18 unmount the whole app to a blank screen
 * (which, for this always-on background service, previously required a full
 * restart). The error is also reported to the main process so it lands in the
 * persistent log for diagnosis.
 *
 * The fallback uses inline styles (no Tailwind/theme classes) so it renders even
 * when the failure is in the styling/layout layer itself.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const detail = `${this.props.area ? `[${this.props.area}] ` : ''}${error?.stack || error?.message || String(error)}\n${info?.componentStack || ''}`
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', detail)
    // Persist to the main-process log (fire-and-forget; guarded in case the
    // bridge is unavailable).
    try {
      window.api?.system?.reportError?.(detail)
    } catch {
      /* ignore — reporting must never throw from the error path */
    }
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  private reset = (): void => this.setState({ error: null })
  private reload = (): void => window.location.reload()

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        style={{
          display: 'flex',
          height: '100%',
          minHeight: '60vh',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'system-ui, sans-serif',
          color: '#e5e7eb'
        }}
      >
        <div
          style={{
            maxWidth: 640,
            width: '100%',
            borderRadius: 12,
            border: '1px solid rgba(239,68,68,0.35)',
            background: 'rgba(239,68,68,0.08)',
            padding: 24
          }}
        >
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#f87171' }}>
            The interface hit an error{this.props.area ? ` in ${this.props.area}` : ''}
          </p>
          <p style={{ marginTop: 8, fontSize: 13, color: '#9ca3af' }}>
            Interfacing is still running in the background. You can retry this view or reload the
            window — instrument data keeps flowing either way.
          </p>
          <pre
            style={{
              marginTop: 12,
              maxHeight: 200,
              overflow: 'auto',
              borderRadius: 8,
              background: 'rgba(0,0,0,0.35)',
              padding: 12,
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              color: '#d1d5db'
            }}
          >
            {error.message || String(error)}
          </pre>
          <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <button
              onClick={this.reset}
              style={{
                cursor: 'pointer',
                borderRadius: 8,
                border: '1px solid rgba(148,163,184,0.4)',
                background: 'transparent',
                color: '#e5e7eb',
                padding: '8px 16px',
                fontSize: 13
              }}
            >
              Try again
            </button>
            <button
              onClick={this.reload}
              style={{
                cursor: 'pointer',
                borderRadius: 8,
                border: 'none',
                background: '#6366f1',
                color: 'white',
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600
              }}
            >
              Reload window
            </button>
          </div>
        </div>
      </div>
    )
  }
}
