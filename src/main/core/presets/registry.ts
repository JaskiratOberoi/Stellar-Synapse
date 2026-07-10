import type {
  AuOnlineTestNo,
  LocationPreset,
  PresetInstrument,
  PresetMapping,
  PresetSerial,
  TransportKind
} from '../../../shared/types'
// Bundled location presets (repo-root /presets). Adding a location = drop a JSON
// file here and add it to RAW_PRESETS, then rebuild. Vite inlines the JSON into
// the main bundle at build time.
import haldwani from '../../../../presets/haldwani.json'
import jammu from '../../../../presets/jammu.json'

/* eslint-disable @typescript-eslint/no-explicit-any */
// The preset JSON files are human-authored and carry documentation keys (_note,
// _doc, ...) and two different shapes for the AU test table, so we read them
// loosely and normalize into the strict LocationPreset shape below.
const RAW_PRESETS: any[] = [haldwani, jammu]

/** Pull the per-site Online Test No. table from either JSON shape (or none). */
function readAuTestNos(inst: any): AuOnlineTestNo[] | undefined {
  // Jammu shape: onlineTestNoMap.entries[{ onlineNo, analyzerCode, synapseCode, name }]
  const entries = inst.onlineTestNoMap?.entries
  if (Array.isArray(entries)) {
    return entries
      .map((e: any) => ({
        no: Number(e.onlineNo),
        code: String(e.synapseCode ?? e.analyzerCode ?? '').trim(),
        name: e.name ? String(e.name) : undefined
      }))
      .filter((e: AuOnlineTestNo) => Number.isFinite(e.no) && e.code.length > 0)
  }
  // Haldwani shape: onlineTestMenu[{ no, code, name, ... }]
  const menu = inst.onlineTestMenu
  if (Array.isArray(menu)) {
    return menu
      .map((t: any) => ({
        no: Number(t.no),
        code: String(t.code ?? '').trim(),
        name: t.name ? String(t.name) : undefined
      }))
      .filter((e: AuOnlineTestNo) => Number.isFinite(e.no) && e.code.length > 0)
  }
  return undefined
}

function readSerial(inst: any): PresetSerial | undefined {
  const s = inst.serial
  if (!s) return undefined
  const out: PresetSerial = {}
  if (typeof s.baudRate === 'number') out.baudRate = s.baudRate
  if (s.dataBits === 7 || s.dataBits === 8) out.dataBits = s.dataBits
  if (s.parity === 'none' || s.parity === 'even' || s.parity === 'odd') out.parity = s.parity
  if (s.stopBits === 1 || s.stopBits === 2) out.stopBits = s.stopBits
  return Object.keys(out).length ? out : undefined
}

/** Per-site analyte -> Noble mappings. Accepts explicit lisTestName/lisParamName
 * or a shorthand `name` (treated as the param name when a paramId is present,
 * else the test name). Rows without an instrumentCode are dropped. */
function readMappings(inst: any): PresetMapping[] | undefined {
  const raw = inst.mappings
  if (!Array.isArray(raw)) return undefined
  const out: PresetMapping[] = []
  for (const m of raw) {
    const code = String(m?.instrumentCode ?? '').trim()
    if (!code) continue
    const hasParam = typeof m.lisParamId === 'number'
    const name = m.name != null ? String(m.name) : undefined
    out.push({
      instrumentCode: code,
      status: m.status === 'manual' ? 'manual' : m.status === 'auto' ? 'auto' : undefined,
      lisTestId: typeof m.lisTestId === 'number' ? m.lisTestId : undefined,
      lisTestCode: m.lisTestCode ? String(m.lisTestCode) : undefined,
      lisTestName: m.lisTestName ? String(m.lisTestName) : hasParam ? undefined : name,
      lisParamId: hasParam ? m.lisParamId : undefined,
      lisParamName: m.lisParamName ? String(m.lisParamName) : hasParam ? name : undefined
    })
  }
  return out.length ? out : undefined
}

function normalizeInstrument(inst: any): PresetInstrument {
  return {
    driverId: String(inst.driverId),
    model: String(inst.model ?? inst.driverId),
    transport: Array.isArray(inst.transports) ? (inst.transports[0] as TransportKind) : undefined,
    port: typeof inst.defaultPort === 'number' ? inst.defaultPort : undefined,
    serial: readSerial(inst),
    auOnlineTestNos: readAuTestNos(inst),
    mappings: readMappings(inst)
  }
}

function normalize(raw: any): LocationPreset {
  const instruments = Array.isArray(raw.instruments) ? raw.instruments : []
  return {
    preset: String(raw.preset),
    location: String(raw.location ?? raw.preset),
    instruments: instruments.map(normalizeInstrument)
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const PRESETS: LocationPreset[] = RAW_PRESETS.map(normalize)

export function listPresets(): LocationPreset[] {
  return PRESETS
}
