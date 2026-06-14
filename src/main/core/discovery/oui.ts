/**
 * Minimal MAC OUI (first 3 octets) -> vendor lookup. This is a best-effort,
 * offline subset; an unknown prefix simply yields `undefined`. It is enough to
 * distinguish common PC/NIC vendors and virtualization platforms from unknown
 * embedded devices (which are the more likely analyzer candidates).
 */
const OUI: Record<string, string> = {
  '000C29': 'VMware (virtual)',
  '005056': 'VMware (virtual)',
  '00155D': 'Microsoft Hyper-V (virtual)',
  '080027': 'VirtualBox (virtual)',
  '00E04C': 'Realtek',
  '001C42': 'Parallels (virtual)',
  '0050F2': 'Microsoft',
  '001B21': 'Intel',
  '001E67': 'Intel',
  '0026B9': 'Dell',
  '001A4B': 'Hewlett-Packard',
  '3C5282': 'Hewlett-Packard',
  '84D81B': 'TP-Link / generic',
  '7C5A1C': 'Router / gateway',
  '309C23': 'Network device',
  '9CA2F4': 'Network device',
  '047C16': 'Network device',
  '000E09': 'Embedded device'
}

export function vendorForMac(mac?: string): string | undefined {
  if (!mac) return undefined
  const prefix = mac.replace(/[-:]/g, '').toUpperCase().slice(0, 6)
  return OUI[prefix]
}
