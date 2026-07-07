import type { CanonicalResult, InstrumentDriverInfo } from '../../../shared/types'
import type { ProtocolMessage } from '../protocols/IProtocol'
import type { ModelDefinition } from './catalog'
import type { DriverAnalyte, IInstrumentDriver } from './IInstrumentDriver'
import { buildBeckmanAuSample, parseBeckmanAu } from './beckmanAu'
import { buildEdanHl7Sample, parseEdanHl7 } from './edan'
import { buildGeteinHl7Sample, parseGeteinHl7 } from './getein'
import { buildMindrayAstmSample, parseMindrayAstm } from './mindray'
import { parseAstm, parseHl7, parseSimple } from './parsing'
import { buildAstmSample, buildHl7Sample, buildSimpleSample } from './sampleBuilders'

/**
 * Data-driven instrument driver. One class powers every catalog model: it
 * normalizes ASTM/HL7 messages via the shared decoders and emits simulated
 * frames in the model's native protocol. Model-specific behavior lives in the
 * `ModelDefinition` (catalog.ts), keeping the catalog declarative and scalable.
 */
export class DefinitionDriver implements IInstrumentDriver {
  constructor(private readonly def: ModelDefinition) {}

  get info(): InstrumentDriverInfo {
    const {
      analytes: _analytes,
      hl7Dialect: _hl7Dialect,
      astmDialect: _astmDialect,
      lisValueOnly: _lisValueOnly,
      astmFlushOnTerminator: _astmFlushOnTerminator,
      transientConnection: _transientConnection,
      ...info
    } = this.def
    return info
  }

  get lisValueOnly(): boolean | undefined {
    return this.def.lisValueOnly
  }

  get astmDialect(): 'mindray' | undefined {
    return this.def.astmDialect
  }

  get astmFlushOnTerminator(): boolean | undefined {
    return this.def.astmFlushOnTerminator
  }

  get transientConnection(): boolean | undefined {
    return this.def.transientConnection
  }

  analytes(): DriverAnalyte[] {
    return this.def.analytes
  }

  parse(message: ProtocolMessage, instrumentId: string): CanonicalResult[] {
    if (message.protocol === 'hl7') {
      // Getein Metis uses OBR-2 (barcode) / OBX-3 (item id) instead of the
      // generic OBR-3 / OBX-3-component layout — route to its own parser.
      if (this.def.hl7Dialect === 'getein') return parseGeteinHl7(message, instrumentId)
      if (this.def.hl7Dialect === 'edan') return parseEdanHl7(message, instrumentId)
      return parseHl7(message, instrumentId)
    }
    if (message.protocol === 'simple') return parseSimple(message, instrumentId)
    if (message.protocol === 'beckman-au') return parseBeckmanAu(message, instrumentId)
    // Mindray BS-series ASTM uses a non-standard field layout (barcode in the O
    // Specimen ID field 4, analyte code/value in component 1).
    if (this.def.astmDialect === 'mindray') return parseMindrayAstm(message, instrumentId)
    return parseAstm(message, instrumentId)
  }

  buildSample(sampleId: string, analytes: DriverAnalyte[]): string {
    if (this.def.protocol === 'hl7') {
      if (this.def.hl7Dialect === 'getein') return buildGeteinHl7Sample(sampleId, this.def.name, analytes)
      if (this.def.hl7Dialect === 'edan') return buildEdanHl7Sample(sampleId, this.def.name, analytes)
      return buildHl7Sample(sampleId, this.def.name, analytes)
    }
    if (this.def.protocol === 'simple') return buildSimpleSample(sampleId, analytes)
    if (this.def.protocol === 'beckman-au') return buildBeckmanAuSample(sampleId, analytes)
    if (this.def.astmDialect === 'mindray') return buildMindrayAstmSample(sampleId, this.def.name, analytes)
    return buildAstmSample(sampleId, this.def.name, analytes)
  }
}
