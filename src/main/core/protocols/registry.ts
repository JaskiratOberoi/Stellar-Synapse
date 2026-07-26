import type { AuWireFormat, ProtocolKind } from '../../../shared/types'
import type { IProtocol } from './IProtocol'
import { AstmProtocol } from './astm'
import { BeckmanAuProtocol, mergeAuFormat } from './beckmanAu'
import { Hl7Protocol } from './hl7'
import { SimpleProtocol } from './simple'

/** Construct a fresh (stateful) protocol decoder for a connection. */
export function createProtocol(
  kind: ProtocolKind,
  opts?: { astmFlushOnTerminator?: boolean; auFormat?: AuWireFormat }
): IProtocol {
  switch (kind) {
    case 'hl7':
      return new Hl7Protocol()
    case 'simple':
      return new SimpleProtocol()
    case 'beckman-au':
      // A per-site frame layout (Run Date/Time, barcode field width, …) shifts
      // where the decoder must slice the header; merge the override onto the
      // AU480 default so unconfigured instruments are unaffected.
      return new BeckmanAuProtocol(opts?.auFormat ? mergeAuFormat(opts.auFormat) : undefined)
    case 'astm':
    case 'poct1a':
    case 'custom':
    default:
      return new AstmProtocol(opts?.astmFlushOnTerminator ?? false)
  }
}
