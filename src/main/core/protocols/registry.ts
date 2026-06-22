import type { ProtocolKind } from '../../../shared/types'
import type { IProtocol } from './IProtocol'
import { AstmProtocol } from './astm'
import { BeckmanAuProtocol } from './beckmanAu'
import { Hl7Protocol } from './hl7'
import { SimpleProtocol } from './simple'

/** Construct a fresh (stateful) protocol decoder for a connection. */
export function createProtocol(
  kind: ProtocolKind,
  opts?: { astmFlushOnTerminator?: boolean }
): IProtocol {
  switch (kind) {
    case 'hl7':
      return new Hl7Protocol()
    case 'simple':
      return new SimpleProtocol()
    case 'beckman-au':
      return new BeckmanAuProtocol()
    case 'astm':
    case 'poct1a':
    case 'custom':
    default:
      return new AstmProtocol(opts?.astmFlushOnTerminator ?? false)
  }
}
