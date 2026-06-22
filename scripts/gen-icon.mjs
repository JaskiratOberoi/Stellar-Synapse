// Render build/icon.svg -> build/icon.png at 1024x1024 (square, transparent
// corners). electron-builder derives the Windows .ico (installer + exe) from
// this PNG. Edit build/icon.svg, then run `npm run icon` to regenerate.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build/icon.svg'), 'utf8')

const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } })
const png = resvg.render().asPng()
writeFileSync(join(root, 'build/icon.png'), png)
console.log(`Wrote build/icon.png (${png.length} bytes, 1024x1024)`)
