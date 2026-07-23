import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }

export default defineConfig(({ mode }) => {
  // Auto-update feed config is injected at build time (never committed). Values
  // come from the environment or a gitignored .env file (SYNAPSE_UPDATE_*).
  // The token is baked into the client so unattended lab PCs can pull releases
  // from the private GitHub repo without any per-machine setup — see
  // src/main/core/update/config.ts and docs/auto-update.md.
  const env = loadEnv(mode, process.cwd(), '')

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
        __UPDATE_OWNER__: JSON.stringify(env.SYNAPSE_UPDATE_OWNER ?? ''),
        __UPDATE_REPO__: JSON.stringify(env.SYNAPSE_UPDATE_REPO ?? ''),
        __UPDATE_TOKEN__: JSON.stringify(env.SYNAPSE_UPDATE_TOKEN ?? '')
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
