import { defineConfig, type UserConfig } from 'tsdown'

const config: UserConfig = defineConfig({
  entry: ['./src/index.ts'],
  platform: 'neutral',
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  treeshake: true,
  clean: true,
  exports: true,
})

// React Server Components decide what ships to the browser by reading the
// 'use client' directive off the module, so the built entry must keep the one
// in `src/index.ts`. Rolldown preserves it; `test/build.test.ts` asserts that it
// still does, because losing it silently breaks every RSC consumer.

export default config
