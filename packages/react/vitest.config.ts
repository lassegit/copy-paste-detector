import { fileURLToPath } from 'node:url'
import { defineConfig, type ViteUserConfig } from 'vitest/config'

const config: ViteUserConfig = defineConfig({
  test: {
    environment: 'happy-dom',
    alias: {
      // Resolve sibling packages to source, so changes there are visible here
      // without a rebuild. Packaging is validated separately by `pnpm build`.
      '@cpd/dom': fileURLToPath(new URL('../dom/src/index.ts', import.meta.url)),
      '@cpd/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
})

export default config
