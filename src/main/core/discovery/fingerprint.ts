import type { ProtocolKind } from '../../../shared/types'
import { getDriver } from '../drivers/registry'

export interface InstrumentFingerprint {
  /** Catalog driver id the data most likely belongs to. */
  driverId: string
  vendor: string
  model: string
  /** Wire protocol detected from the data itself (not the catalog default). */
  protocol: ProtocolKind
  /** 0..1 - higher when an exact model number matched. */
  confidence: number
  /** The header line the identification was drawn from. */
  evidence: string
}

/**
 * Vendor/model signature rules, ordered specific -> generic. The `id` must be a
 * real catalog driver id; `strong` marks an exact-model match (high confidence).
 */
const RULES: { re: RegExp; id: string; strong: boolean }[] = [
  // SNIBE - Maglumi (CLIA)
  { re: /MAGLUMI\s*X\s*10/i, id: 'maglumi-x10', strong: true },
  { re: /MAGLUMI\s*X\s*8/i, id: 'maglumi-x8', strong: true },
  { re: /MAGLUMI\s*X\s*6/i, id: 'maglumi-x6', strong: true },
  { re: /MAGLUMI\s*X\s*3/i, id: 'maglumi-x3', strong: true },
  { re: /MAGLUMI\s*4000\s*PLUS/i, id: 'maglumi-4000-plus', strong: true },
  { re: /MAGLUMI\s*4000/i, id: 'maglumi-4000', strong: true },
  { re: /MAGLUMI\s*2000\s*PLUS/i, id: 'maglumi-2000-plus', strong: true },
  { re: /MAGLUMI\s*2000/i, id: 'maglumi-2000', strong: true },
  { re: /MAGLUMI\s*1000/i, id: 'maglumi-1000', strong: true },
  { re: /MAGLUMI\s*800/i, id: 'maglumi-800', strong: true },
  { re: /MAGLUMI\s*600/i, id: 'maglumi-600', strong: true },
  { re: /MAGLUMI/i, id: 'maglumi-x3', strong: false },
  // SNIBE - other lines
  { re: /BIOLUMI/i, id: 'biolumi-cx8', strong: true },
  { re: /BIOSSAYS\s*C\s*10/i, id: 'biossays-c10', strong: true },
  { re: /BIOSSAYS/i, id: 'biossays-c8', strong: false },
  { re: /HEMOLUMI/i, id: 'snibe-hemolumi', strong: true },
  { re: /SNIBE/i, id: 'maglumi-x3', strong: false },
  // Getein - MAGICL (CLIA)
  { re: /MAGICL\s*8500/i, id: 'magicl-8500', strong: true },
  { re: /MAGICL\s*6800/i, id: 'magicl-6800', strong: true },
  { re: /MAGICL\s*6200/i, id: 'magicl-6200', strong: true },
  { re: /MAGICL\s*6100/i, id: 'magicl-6100', strong: true },
  { re: /MAGICL\s*6000\s*I/i, id: 'magicl-6000i', strong: true },
  { re: /MAGICL\s*6000/i, id: 'magicl-6000', strong: true },
  { re: /MAGICL/i, id: 'magicl-6000', strong: false },
  // Getein - immunofluorescence
  { re: /GETEIN\s*1600/i, id: 'getein-1600', strong: true },
  { re: /GETEIN\s*1200/i, id: 'getein-1200', strong: true },
  { re: /GETEIN\s*1180/i, id: 'getein-1180', strong: true },
  { re: /GETEIN\s*1160/i, id: 'getein-1160', strong: true },
  { re: /GETEIN\s*1100/i, id: 'getein-1100', strong: true },
  { re: /FIA\s*8600/i, id: 'getein-fia-8600', strong: true },
  { re: /FIA\s*8000/i, id: 'getein-fia-8000', strong: true },
  { re: /GETEIN/i, id: 'magicl-6000', strong: false },
  // Beckman Coulter
  { re: /DXH\s*900/i, id: 'beckman-dxh-900', strong: true },
  { re: /DXH\s*690/i, id: 'beckman-dxh-690t', strong: true },
  { re: /DXH\s*560/i, id: 'beckman-dxh-560', strong: true },
  { re: /DXH\s*520/i, id: 'beckman-dxh-520', strong: true },
  { re: /DXH\s*500/i, id: 'beckman-coulter', strong: true },
  { re: /DXH/i, id: 'beckman-coulter', strong: false },
  { re: /DXI\s*9000/i, id: 'beckman-dxi-9000', strong: true },
  { re: /DXI\s*800/i, id: 'beckman-dxi-800', strong: true },
  { re: /DXI\s*600/i, id: 'beckman-dxi-600', strong: true },
  { re: /UNICEL\s*DXI|ACCESS\s*2|ACCESS/i, id: 'beckman-access-2', strong: true },
  { re: /AU\s*5800/i, id: 'beckman-au5800', strong: true },
  { re: /AU\s*680/i, id: 'beckman-au680', strong: true },
  { re: /AU\s*480/i, id: 'beckman-au480', strong: true },
  { re: /DXC\s*700/i, id: 'beckman-dxc-700-au', strong: true },
  { re: /DXC\s*500\s*I/i, id: 'beckman-dxc-500i', strong: true },
  { re: /DXC\s*500/i, id: 'beckman-dxc-500-au', strong: true },
  { re: /BECKMAN|COULTER/i, id: 'beckman-coulter', strong: false },
  // Boule - Swelab Lumi / Medonic M51 (HL7 MSH self-identifies as BM500 / Boule)
  { re: /SWELAB\s*LUMI/i, id: 'swelab-lumi', strong: true },
  { re: /MEDONIC\s*M\s*51/i, id: 'medonic-m51', strong: true },
  { re: /SWELAB|BM500|BOULE|MEDONIC/i, id: 'swelab-lumi', strong: false },
  // Agappe - Mispa HX 58 hematology (Dymind OEM; ASTM H record self-identifies)
  { re: /MISPA\s*HX\s*58/i, id: 'agappe-mispa-hx58', strong: true },
  { re: /MISPA\s*HX|DYMIND/i, id: 'agappe-mispa-hx58', strong: false },
  // Mindray - BS-series clinical chemistry (H record self-identifies as "Mindry")
  { re: /BS[\s-]*480/i, id: 'mindray-bs-480', strong: true },
  { re: /BS[\s-]*430/i, id: 'mindray-bs-430', strong: true },
  { re: /BS[\s-]*420/i, id: 'mindray-bs-420', strong: true },
  { re: /BS[\s-]*400/i, id: 'mindray-bs-400', strong: true },
  { re: /BS[\s-]*380/i, id: 'mindray-bs-380', strong: true },
  { re: /BS[\s-]*350/i, id: 'mindray-bs-350', strong: true },
  { re: /BS[\s-]*330/i, id: 'mindray-bs-330', strong: true },
  { re: /BS[\s-]*240/i, id: 'mindray-bs-240', strong: true },
  { re: /BS[\s-]*200/i, id: 'mindray-bs-200', strong: true },
  { re: /MINDRAY|MINDRY/i, id: 'mindray-bs-430', strong: false }
]

/** Detect the wire protocol from raw bytes (text). */
export function detectProtocol(raw: string): ProtocolKind | null {
  if (/(^|[\r\n\x0b])MSH\|/.test(raw)) return 'hl7'
  if (/(^|[\r\n\x05\x02])H\|/.test(raw) || /[\r\n]R\|/.test(raw) || /[\r\n]O\|/.test(raw)) {
    return 'astm'
  }
  return null
}

/** Pull the most identifying header line (ASTM H record or HL7 MSH). */
function headerLine(raw: string): string {
  const lines = raw.split(/[\r\n]+/)
  const h = lines.find((l) => /^H\|/.test(l)) ?? lines.find((l) => /^MSH\|/.test(l))
  const line = (h ?? lines.find((l) => l.trim().length > 0) ?? '').trim()
  return line.length > 160 ? `${line.slice(0, 160)}...` : line
}

/**
 * Best-effort vendor/model identification from a captured frame. Returns null
 * when no known vendor signature is present (caller keeps the generic driver).
 */
export function fingerprintInstrument(raw: string): InstrumentFingerprint | null {
  const protocol = detectProtocol(raw) ?? 'astm'
  for (const rule of RULES) {
    if (!rule.re.test(raw)) continue
    const driver = getDriver(rule.id)
    if (!driver) continue
    return {
      driverId: rule.id,
      vendor: driver.info.vendor,
      model: driver.info.name,
      protocol,
      confidence: rule.strong ? 0.95 : 0.6,
      evidence: headerLine(raw)
    }
  }
  return null
}
