import type { ProtocolMessage } from './IProtocol'
import {
  extractLd560TransmitFrameStrings,
  ld560SampleToRecords,
  parseLd560SampleFromRaw
} from '../../../shared/ld560Transmit'

export { parseLd560SampleFromRaw, normalizeLd560Raw } from '../../../shared/ld560Transmit'

export function parseLd560TransmitBlock(block: string): ProtocolMessage | null {
  const sample = parseLd560SampleFromRaw(block)
  if (!sample) return null
  return {
    protocol: 'simple',
    records: ld560SampleToRecords(sample),
    raw: sample.raw
  }
}

export function extractLd560TransmitFrames(buf: string): {
  messages: ProtocolMessage[]
  rest: string
} {
  const { frames, rest } = extractLd560TransmitFrameStrings(buf)
  const messages: ProtocolMessage[] = []
  for (const block of frames) {
    const msg = parseLd560TransmitBlock(block)
    if (msg) messages.push(msg)
  }
  return { messages, rest }
}
