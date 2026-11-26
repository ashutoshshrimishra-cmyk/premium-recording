import { execSync } from 'node:child_process'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'

function resolveCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

const buildDefines = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __BUILD_COMMIT__: JSON.stringify(resolveCommit()),
  __BUILD_TIME__: JSON.stringify(new Date().toISOString())
}

export default defineConfig({
  main: { define: buildDefines },
  preload: {},
  renderer: {
    define: buildDefines,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
