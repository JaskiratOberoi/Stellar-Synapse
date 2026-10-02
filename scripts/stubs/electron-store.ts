/**
 * In-memory stand-in for electron-store, aliased in by verify scripts that drive
 * real engine classes (MappingEngine) outside Electron. Nothing touches disk.
 */
export default class Store<T extends Record<string, unknown>> {
  private data: Record<string, unknown>

  constructor(opts: { defaults?: T } = {}) {
    this.data = structuredClone(opts.defaults ?? {}) as Record<string, unknown>
  }

  get(key: string): unknown {
    return this.data[key]
  }

  set(key: string, value: unknown): void {
    this.data[key] = value
  }
}
