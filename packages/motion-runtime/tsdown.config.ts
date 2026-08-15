import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/index.ts',
    dom: './src/dom.ts',
    drivers: './src/drivers.ts',
    kernel: './src/kernel.ts',
    vanilla: './src/vanilla.ts',
    vue: './src/vue.ts'
  },
  platform: 'neutral',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  hash: false,
  clean: true,
  outDir: './dist',
  treeshake: {
    moduleSideEffects: false
  },
  deps: {
    neverBundle: [
      '@open-pencil/motion',
      /^@open-pencil\/motion\//,
      '@open-pencil/scene-graph',
      /^@open-pencil\/scene-graph\//,
      'vue',
      /^vue\//
    ],
    onlyBundle: false
  },
  outputOptions: {
    minifyInternalExports: false
  }
})
