import { fileURLToPath } from 'node:url'
import { defineConfig, type ViteUserConfig } from 'vitest/config'

const config: ViteUserConfig = defineConfig({
  test: {
    environment: 'happy-dom',
    alias: {
      // Resolve the sibling package to its source, so a change there is visible
      // here without a rebuild. Packaging is validated separately by `pnpm build`.
      '@cpd/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
})

export default config
