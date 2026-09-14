import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { logger } from '../logger'

/**
 * On-disk store for pictures an analyzer embeds in a result frame (LD-560
 * chromatograms in "Base 64" picture mode). Files live under
 * `<userData>/images/<instrumentId>/<sampleId>__<analyzer file name>` so a
 * re-transmitted frame overwrites its own picture instead of piling up copies.
 */
export function imagesRoot(): string {
  return join(app.getPath('userData'), 'images')
}

function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'x'
}

/** Decode and write the picture; returns the absolute file path or null on failure. */
export function saveInstrumentImage(
  instrumentId: string,
  sampleId: string,
  name: string,
  base64: string
): string | null {
  try {
    const dir = join(imagesRoot(), safeSegment(instrumentId))
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    let fileName = safeSegment(name)
    if (!/\.(png|jpe?g|bmp|gif)$/i.test(fileName)) fileName += '.png'
    const file = join(dir, `${safeSegment(sampleId)}__${fileName}`)
    writeFileSync(file, Buffer.from(base64, 'base64'))
    return file
  } catch (err) {
    logger.warn('image', `Could not save picture ${name} for ${sampleId}: ${(err as Error).message}`)
    return null
  }
}

/** Read a saved picture as a data: URL for the renderer. Only files under the images root are served. */
export function readInstrumentImage(file: string): string | null {
  try {
    const root = resolve(imagesRoot()) + sep
    const abs = resolve(file)
    if (!abs.startsWith(root) || !existsSync(abs)) return null
    const ext = abs.toLowerCase().split('.').pop()
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'bmp' ? 'image/bmp' : ext === 'gif' ? 'image/gif' : 'image/png'
    return `data:${mime};base64,${readFileSync(abs).toString('base64')}`
  } catch {
    return null
  }
}
