import type { DriverAnalyte } from './IInstrumentDriver'

function ts(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`
}

/** Pick a plausible value for an analyte, occasionally flagged abnormal. */
export function simValue(a: DriverAnalyte): { value: string; flag: string } {
  const { min, max, decimals = 2 } = a.sim ?? { min: 1, max: 100 }
  let v = min + Math.random() * (max - min)
  let flag = 'N'
  const roll = Math.random()
  if (roll > 0.85) {
    v = max * (1 + Math.random() * 0.6)
    flag = 'H'
  } else if (roll < 0.1) {
    v = min * (0.2 + Math.random() * 0.5)
    flag = 'L'
  }
  return { value: v.toFixed(decimals), flag }
}

/** Build an ASTM E1394 message body (text) for a sample. */
export function buildAstmSample(
  sampleId: string,
  instrumentName: string,
  analytes: DriverAnalyte[]
): string {
  const lines: string[] = []
  lines.push(`H|\\^&|||${instrumentName}|||||LIS||P|E1394-97|${ts()}`)
  lines.push(`P|1`)
  analytes.forEach((a, i) => {
    lines.push(`O|${i + 1}|${sampleId}||^^^${a.code}|R||${ts()}`)
    const { value, flag } = simValue(a)
    lines.push(
      `R|1|^^^${a.code}^${a.name}|${value}|${a.unit ?? ''}|${a.sim?.ref ?? ''}|${flag}||F||${ts()}`
    )
  })
  lines.push(`L|1|N`)
  return lines.join('\r')
}

/** Build an HL7 v2.x ORU^R01 message body (text) for a sample. */
export function buildHl7Sample(
  sampleId: string,
  instrumentName: string,
  analytes: DriverAnalyte[]
): string {
  const lines: string[] = []
  lines.push(`MSH|^~\\&|${instrumentName}||LIS||${ts()}||ORU^R01|${sampleId}|P|2.5`)
  lines.push(`PID|1||UNKNOWN`)
  lines.push(`OBR|1|${sampleId}|${sampleId}|PANEL^Result Panel|||${ts()}`)
  analytes.forEach((a, i) => {
    const { value, flag } = simValue(a)
    lines.push(
      `OBX|${i + 1}|NM|${a.code}^${a.name}||${value}|${a.unit ?? ''}|${a.sim?.ref ?? ''}|${flag}|||F`
    )
  })
  return lines.join('\r')
}

/** Generate a believable sample/accession barcode. */
export function randomSampleId(prefix = 'S'): string {
  const n = Math.floor(100000 + Math.random() * 899999)
  return `${prefix}${n}`
}
