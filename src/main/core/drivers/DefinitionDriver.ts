import type { CanonicalResult, InstrumentDriverInfo } from '../../../shared/types'
import type { ProtocolMessage } from '../protocols/IProtocol'
import type { ModelDefinition } from './catalog'
import type { DriverAnalyte, IInstrumentDriver } from './IInstrumentDriver'
import { parseAstm, parseHl7 } from './parsing'
import { buildAstmSample, buildHl7Sample } from './sampleBuilders'

/**
 * Data-driven instrument driver. One class powers every catalog model: it
 * normalizes ASTM/HL7 messages via the shared decoders and emits simulated
 * frames in the model's native protocol. Model-specific behavior lives in the
 * `ModelDefinition` (catalog.ts), keeping the catalog declarative and scalable.
 */
export class DefinitionDriver implements IInstrumentDriver {
  constructor(private readonly def: ModelDefinition) {}

  get info(): InstrumentDriverInfo {
    const { analytes: _analytes, ...info } = this.def
    return info
  }

  analytes(): DriverAnalyte[] {
    return this.def.analytes
  }

  parse(message: ProtocolMessage, instrumentId: string): CanonicalResult[] {
    return message.protocol === 'hl7'
      ? parseHl7(message, instrumentId)
      : parseAstm(message, instrumentId)
  }

  buildSample(sampleId: string, analytes: DriverAnalyte[]): string {
    return this.def.protocol === 'hl7'
      ? buildHl7Sample(sampleId, this.def.name, analytes)
      : buildAstmSample(sampleId, this.def.name, analytes)
  }
}
