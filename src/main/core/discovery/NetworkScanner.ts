import net from 'node:net'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { DiscoveredHost, DiscoveredPort, DiscoverySubnet, ScanProgress } from '../../../shared/types'
import { CANDIDATE_PORTS } from './ports'
import { vendorForMac } from './oui'
import { logger } from '../logger'

const VIRTUAL_HINTS = ['vethernet', 'vmware', 'virtualbox', 'wsl', 'hyper-v', 'bluetooth', 'loopback', 'vmnet', 'tunnel']

/**
 * Read-only LAN scanner. Discovery is non-intrusive: it performs TCP connect
 * probes (SYN, then immediate close - no application data sent) and reads the
 * OS ARP cache. It never writes to any device or changes any configuration.
 *
 * Events:
 *  - 'progress' (ScanProgress)
 *  - 'host'     (DiscoveredHost)
 */
export class NetworkScanner extends EventEmitter {
  private cancelled = false
  private scanning = false

  /** Enumerate IPv4 /24-style subnets from local interfaces. */
  getSubnets(): DiscoverySubnet[] {
    const ifaces = os.networkInterfaces()
    const out: DiscoverySubnet[] = []
    for (const [name, addrs] of Object.entries(ifaces)) {
      for (const a of addrs ?? []) {
        if (a.family !== 'IPv4' || a.internal) continue
        const base = a.address.split('.').slice(0, 3).join('.')
        out.push({
          cidr: `${base}.0/24`,
          address: a.address,
          netmask: a.netmask,
          interfaceName: name,
          isVirtual: VIRTUAL_HINTS.some((h) => name.toLowerCase().includes(h))
        })
      }
    }
    // Physical adapters first.
    return out.sort((x, y) => Number(x.isVirtual) - Number(y.isVirtual))
  }

  stop(): void {
    this.cancelled = true
  }

  /** Scan a /24 subnet given as CIDR or any address within it. */
  async scan(cidr: string): Promise<DiscoveredHost[]> {
    if (this.scanning) return []
    this.scanning = true
    this.cancelled = false

    const base = cidr.split('/')[0].split('.').slice(0, 3).join('.')
    const self = this.getSubnets().find((s) => s.cidr === `${base}.0/24`)?.address
    const hosts = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`)
    const total = hosts.length
    logger.info('discovery', `Scanning ${base}.0/24 (${total} hosts, read-only)...`)

    const found = new Map<string, DiscoveredHost>()
    let scanned = 0
    const batchSize = 16

    for (let i = 0; i < hosts.length; i += batchSize) {
      if (this.cancelled) break
      const batch = hosts.slice(i, i + batchSize)
      await Promise.all(
        batch.map(async (ip) => {
          const host = await this.probeHost(ip, ip === self)
          scanned++
          if (host) {
            found.set(ip, host)
            this.emit('host', host)
          }
          this.emitProgress({ cidr: `${base}.0/24`, scanned, total, percent: Math.round((scanned / total) * 100), done: false })
        })
      )
    }

    // Enrich with ARP (MAC + vendor); also surface ARP-only hosts.
    await this.enrichWithArp(base, found, self)

    this.emitProgress({ cidr: `${base}.0/24`, scanned: total, total, percent: 100, done: true })
    this.scanning = false
    const result = [...found.values()].sort((a, b) => this.ipNum(a.ip) - this.ipNum(b.ip))
    logger.info('discovery', `Scan complete: ${result.length} host(s) on ${base}.0/24`)
    return result
  }

  private async probeHost(ip: string, isSelf: boolean): Promise<DiscoveredHost | null> {
    const open: DiscoveredPort[] = []
    let reachable = false

    await Promise.all(
      CANDIDATE_PORTS.map(async (cp) => {
        const state = await this.probePort(ip, cp.port, 500)
        if (state === 'open') {
          open.push({ port: cp.port, service: cp.service })
          reachable = true
        } else if (state === 'refused') {
          reachable = true
        }
      })
    )

    if (!reachable && !isSelf) return null

    open.sort((a, b) => a.port - b.port)
    const guess = this.guess(open)
    return {
      ip,
      reachable: true,
      openPorts: open,
      isSelf,
      guessedDriverId: guess?.driverId,
      guessedInstrument: guess?.label,
      lastSeen: new Date().toISOString()
    }
  }

  private probePort(host: string, port: number, timeoutMs: number): Promise<'open' | 'refused' | 'down'> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      let settled = false
      const done = (r: 'open' | 'refused' | 'down'): void => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve(r)
      }
      socket.setTimeout(timeoutMs)
      socket.once('connect', () => done('open'))
      socket.once('timeout', () => done('down'))
      socket.once('error', (err: NodeJS.ErrnoException) =>
        done(err.code === 'ECONNREFUSED' ? 'refused' : 'down')
      )
      socket.connect(port, host)
    })
  }

  private guess(open: DiscoveredPort[]): { driverId: string; label: string } | undefined {
    const ports = open.map((p) => p.port)
    const hasInstrument = CANDIDATE_PORTS.some((c) => c.instrument && ports.includes(c.port))
    if (hasInstrument) {
      return { driverId: 'generic-astm', label: 'ASTM/HL7 analyzer (generic)' }
    }
    if (ports.includes(1433)) return { driverId: '', label: 'LIS database host (SQL Server)' }
    return undefined
  }

  private enrichWithArp(base: string, found: Map<string, DiscoveredHost>, self?: string): Promise<void> {
    return new Promise((resolve) => {
      execFile('arp', ['-a'], { windowsHide: true }, (_err, stdout) => {
        const re = /(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5})/g
        let m: RegExpExecArray | null
        while ((m = re.exec(stdout || '')) !== null) {
          const ip = m[1]
          const mac = m[2].toLowerCase()
          if (!ip.startsWith(`${base}.`)) continue
          if (ip.endsWith('.255')) continue
          const vendor = vendorForMac(mac)
          const existing = found.get(ip)
          if (existing) {
            existing.mac = mac
            existing.vendor = vendor
          } else {
            found.set(ip, {
              ip,
              mac,
              vendor,
              reachable: true,
              openPorts: [],
              isSelf: ip === self,
              lastSeen: new Date().toISOString()
            })
          }
        }
        resolve()
      })
    })
  }

  private emitProgress(p: ScanProgress): void {
    this.emit('progress', p)
  }

  private ipNum(ip: string): number {
    return ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0)
  }
}
