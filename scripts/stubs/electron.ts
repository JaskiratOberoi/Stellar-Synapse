/**
 * Minimal stand-in for the `electron` module, aliased in by verify scripts that
 * drive the real engine (Orchestrator) outside Electron. Only what the engine's
 * import graph touches at load time: `app` paths resolve into a scratch folder.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'synapse-verify-'))
const paths = new Map<string, string>()

export const app = {
  isPackaged: false,
  getVersion: (): string => '0.0.0-verify',
  getName: (): string => 'stellar-synapse',
  getPath: (name: string): string => paths.get(name) ?? join(base, name),
  setPath: (name: string, value: string): void => {
    paths.set(name, value)
  },
  on: (): void => undefined,
  whenReady: (): Promise<void> => Promise.resolve()
}

export class Notification {
  constructor(_opts?: unknown) {}
  show(): void {}
  on(): this {
    return this
  }
}

export default { app, Notification }
