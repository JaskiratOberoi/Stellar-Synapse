import { create } from 'zustand'
import type { DiscoveredHost, DiscoverySubnet, ScanProgress } from '@shared/types'

interface DiscoveryState {
  subnets: DiscoverySubnet[]
  hosts: DiscoveredHost[]
  scanning: boolean
  progress: ScanProgress | null
  subscribed: boolean

  loadSubnets: () => Promise<DiscoverySubnet[]>
  scan: (cidr: string) => Promise<void>
  stop: () => Promise<void>
  subscribe: () => void
}

export const useDiscoveryStore = create<DiscoveryState>((set, get) => ({
  subnets: [],
  hosts: [],
  scanning: false,
  progress: null,
  subscribed: false,

  loadSubnets: async () => {
    const subnets = await window.api.discovery.subnets()
    set({ subnets })
    return subnets
  },

  subscribe: () => {
    if (get().subscribed) return
    set({ subscribed: true })
    window.api.discovery.onProgress((p) => set({ progress: p, scanning: !p.done }))
    window.api.discovery.onHost((host) =>
      set((st) => {
        const others = st.hosts.filter((h) => h.ip !== host.ip)
        return { hosts: [...others, host].sort((a, b) => ipNum(a.ip) - ipNum(b.ip)) }
      })
    )
  },

  scan: async (cidr) => {
    get().subscribe()
    set({ scanning: true, hosts: [], progress: { cidr, scanned: 0, total: 254, percent: 0, done: false } })
    const hosts = await window.api.discovery.scan(cidr)
    set({ hosts, scanning: false })
  },

  stop: async () => {
    await window.api.discovery.stop()
    set({ scanning: false })
  }
}))

function ipNum(ip: string): number {
  return ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0)
}
