import { defineConfig } from 'vitest/config'

// Used only by `npm run bench:overlay`. The default config (npm test) does not
// match *.bench.ts, so benchmarks never run with the test suite.
export default defineConfig({
  test: { include: ['bench/**/*.bench.ts'], testTimeout: 120000 }
})
