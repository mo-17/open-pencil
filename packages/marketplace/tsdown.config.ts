import { readFileSync } from 'node:fs'

import { defineConfig } from 'tsdown'

const packageJSON = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as {
  dependencies?: Record<string, string>
}

export default defineConfig({
  entry: { index: './src/index.ts', cli: './src/cli.ts' },
  platform: 'node',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: './dist',
  deps: {
    neverBundle: [...Object.keys(packageJSON.dependencies ?? {}), /^node:/, /^bun:/],
    onlyBundle: false
  }
})
