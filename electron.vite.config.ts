import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }

/** "https://host/api/updates/synapse" -> "https://host"; empty when unparseable. */
function originOf(url: string): string {
  try {
    return url ? new URL(url).origin : ''
  } catch {
    return ''
  }
}

export default defineConfig(({ mode }) => {
  // Auto-update feed config is injected at build time (never committed). Values
  // come from the environment or a gitignored .env file (SYNAPSE_UPDATE_*).
  // The fleet key is baked into the client so unattended lab PCs can pull
  // releases from the Infinity-hosted feed without any per-machine setup — see
  // src/main/core/update/config.ts and docs/auto-update.md.
  const env = loadEnv(mode, process.cwd(), '')
  // The platform every install reports to and enrols with. Defaults to the
  // update feed's origin so a build with only the feed configured still
  // enrols; set SYNAPSE_INFINITY_URL when the feed and the platform differ.
  const infinityUrl = (env.SYNAPSE_INFINITY_URL ?? '').trim() || originOf(env.SYNAPSE_UPDATE_URL ?? '')

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          '@shared': resolve('src/shared'),
          '@main': resolve('src/main')
        }
      },
      define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
        __UPDATE_URL__: JSON.stringify(env.SYNAPSE_UPDATE_URL ?? ''),
        __UPDATE_KEY__: JSON.stringify(env.SYNAPSE_UPDATE_KEY ?? ''),
        __INFINITY_URL__: JSON.stringify(infinityUrl)
      },
      build: {
        rollupOptions: {
          input: {
            index: resolve('src/main/index.ts')
          }
        }
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: {
            index: resolve('src/preload/index.ts')
          }
        }
      }
    },
    renderer: {
      root: 'src/renderer',
      server: {
        port: 14323,
        strictPort: true
      },
      resolve: {
        alias: {
          '@': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      plugins: [react()],
      define: {
        __APP_VERSION__: JSON.stringify(pkg.version)
      },
      build: {
        rollupOptions: {
          input: {
            index: resolve('src/renderer/index.html')
          }
        }
      }
    }
  }
})
