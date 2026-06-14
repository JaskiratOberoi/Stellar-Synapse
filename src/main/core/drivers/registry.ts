import type { InstrumentDriverInfo } from '../../../shared/types'
import { CATALOG } from './catalog'
import { DefinitionDriver } from './DefinitionDriver'
import type { IInstrumentDriver } from './IInstrumentDriver'

/**
 * Driver registry. Drivers are built from the declarative model catalog
 * (catalog.ts). To add support for a new analyzer, add a ModelDefinition to the
 * catalog - it will automatically appear in the "Add Instrument" catalog and
 * (once an instrument is configured) seed the mapping screen.
 */
const drivers = new Map<string, IInstrumentDriver>()

function register(driver: IInstrumentDriver): void {
  drivers.set(driver.info.id, driver)
}

for (const def of CATALOG) {
  register(new DefinitionDriver(def))
}

export function getDriver(id: string): IInstrumentDriver | undefined {
  return drivers.get(id)
}

export function listDrivers(): IInstrumentDriver[] {
  return [...drivers.values()]
}

export function listDriverInfos(): InstrumentDriverInfo[] {
  return listDrivers().map((d) => d.info)
}
