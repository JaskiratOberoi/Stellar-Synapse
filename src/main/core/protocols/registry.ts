import type { ProtocolKind } from '../../../shared/types'
import type { IProtocol } from './IProtocol'
import { AstmProtocol } from './astm'
import { Hl7Protocol } from './hl7'

/** Construct a fresh (stateful) protocol decoder for a connection. */
export function createProtocol(kind: ProtocolKind): IProtocol {
  switch (kind) {
    case 'hl7':
      return new Hl7Protocol()
    case 'astm':
    case 'poct1a':
    case 'custom':
    default:
      return new AstmProtocol()
  }
}
