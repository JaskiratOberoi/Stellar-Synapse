import type { StellarApi } from '../shared/ipc'

declare global {
  interface Window {
    api: StellarApi
  }
}

export {}
