import type { ITransport } from './ITransport'
import { TcpServer } from './TcpServer'
import { TcpClient } from './TcpClient'
import { SerialTransport } from './SerialTransport'
import type { InstrumentConnectionConfig } from '../../../shared/types'

/** Build the right transport for an instrument's connection config. */
export function createTransport(
  instrumentId: string,
  config: InstrumentConnectionConfig
): ITransport {
  switch (config.transport) {
    case 'serial':
      return new SerialTransport(instrumentId, config)
    case 'tcp-client':
      // Middleware dials the analyzer (used for passive read-only taps and for
      // analyzers that act as TCP servers).
      return new TcpClient(instrumentId, config)
    case 'tcp-server':
    default:
      // Analyzer connects inward to us (the common analyzer-as-client model).
      return new TcpServer(instrumentId, config)
  }
}
