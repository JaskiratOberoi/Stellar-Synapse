import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/globals.css'

// Report uncaught async errors (outside React's render path, which the
// ErrorBoundary covers) to the main log so intermittent failures are diagnosable.
window.addEventListener('error', (e) => {
  try {
    window.api?.system?.reportError?.(`window.onerror: ${e.error?.stack || e.message}`)
  } catch {
    /* never throw from the error path */
  }
})
window.addEventListener('unhandledrejection', (e) => {
  try {
    const r = e.reason
    window.api?.system?.reportError?.(`unhandledrejection: ${r?.stack || r?.message || String(r)}`)
  } catch {
    /* never throw from the error path */
  }
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary area="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
