import { defineConfig } from 'tsdown'

const shared = {
  format: ['esm'] as const,
  dts: true,
  sourcemap: true,
  outDir: './dist',
  outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
  treeshake: false,
  deps: {
    neverBundle: [
      '@hono/node-server',
      '@modelcontextprotocol/server',
      '@open-pencil/core',
      /^@open-pencil\/core\//,
      'hono',
      /^hono\//,
      'package-manager-detector',
      /^package-manager-detector\//,
      'ws',
      'zod',
      /^node:/
    ],
    onlyBundle: false
  }
}

export default defineConfig([
  {
    ...shared,
    entry: {
      index: './src/index.ts',
      server: './src/server.ts',
      stdio: './src/stdio.ts',
      transport: './src/transport/paths.ts',
      discovery: './src/transport/discovery.ts',
      'motion-export': './src/motion-export/index.ts'
    },
    platform: 'node',
    clean: true
  },
  {
    ...shared,
    // These public metadata entries are consumed by the browser. A separate neutral build
    // prevents the Node server's CommonJS runtime helper from becoming their shared chunk.
    entry: {
      'plugin-contract': './src/tool/plugin/contract.ts',
      tools: './src/tool/index.ts'
    },
    platform: 'neutral',
    clean: false
  }
])
