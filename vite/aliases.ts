import { resolve } from 'node:path'

export function createOpenPencilAliases(rootDir: string) {
  const emptyNodeModule = resolve(rootDir, 'vite/empty-node-module.ts')

  return [
    { find: /^fs$/, replacement: emptyNodeModule },
    { find: /^path$/, replacement: emptyNodeModule },
    { find: '@', replacement: resolve(rootDir, 'src') },
    { find: '#vue', replacement: resolve(rootDir, 'packages/vue/src') },
    {
      find: /^#core\/text\/bundled-font-loader$/,
      replacement: resolve(rootDir, 'packages/core/src/text/bundled-font-loader.browser.ts')
    },
    { find: '#core', replacement: resolve(rootDir, 'packages/core/src') },
    { find: '#compiler', replacement: resolve(rootDir, 'packages/compiler/src') },
    { find: '#lowcode', replacement: resolve(rootDir, 'packages/lowcode/src') },
    { find: '#dom-css', replacement: resolve(rootDir, 'packages/dom-css/src') },
    {
      find: /^@open-pencil\/dom-css\/browser$/,
      replacement: resolve(rootDir, 'packages/dom-css/src/browser.ts')
    },
    {
      find: /^@open-pencil\/dom-css\/export$/,
      replacement: resolve(rootDir, 'packages/dom-css/src/export/index.ts')
    },
    {
      find: /^@open-pencil\/dom-css\/scene-graph$/,
      replacement: resolve(rootDir, 'packages/dom-css/src/import/scene-graph.ts')
    },
    {
      find: /^@open-pencil\/dom-css\/jsx-runtime$/,
      replacement: resolve(rootDir, 'packages/dom-css/src/import/jsx/runtime.ts')
    },
    {
      find: /^@open-pencil\/dom-css\/jsx-dev-runtime$/,
      replacement: resolve(rootDir, 'packages/dom-css/src/import/jsx/dev-runtime.ts')
    },
    {
      find: /^@open-pencil\/dom-css$/,
      replacement: resolve(rootDir, 'packages/dom-css/src/index.ts')
    },
    {
      find: /^@open-pencil\/lowcode\/application-runtime$/,
      replacement: resolve(rootDir, 'packages/lowcode/src/application-runtime.ts')
    },
    {
      find: /^@open-pencil\/lowcode$/,
      replacement: resolve(rootDir, 'packages/lowcode/src/index.ts')
    },
    { find: '@open-pencil/lowcode', replacement: resolve(rootDir, 'packages/lowcode/src') },
    {
      find: /^@open-pencil\/motion$/,
      replacement: resolve(rootDir, 'packages/motion/src/index.ts')
    },
    {
      find: /^@open-pencil\/plugin-contracts\/adapter-helpers$/,
      replacement: resolve(rootDir, 'packages/plugin-contracts/src/adapter-helpers.ts')
    },
    {
      find: /^@open-pencil\/plugin-contracts$/,
      replacement: resolve(rootDir, 'packages/plugin-contracts/src/index.ts')
    },
    {
      find: /^@open-pencil\/scene-graph$/,
      replacement: resolve(rootDir, 'packages/scene-graph/src/index.ts')
    },
    // Subpaths whose names differ from their files under src/.
    {
      find: /^@open-pencil\/scene-graph\/text-direction$/,
      replacement: resolve(rootDir, 'packages/scene-graph/src/text/direction.ts')
    },
    {
      find: /^@open-pencil\/scene-graph\/text-picture$/,
      replacement: resolve(rootDir, 'packages/scene-graph/src/text/picture.ts')
    },
    { find: '@open-pencil/scene-graph', replacement: resolve(rootDir, 'packages/scene-graph/src') },
    { find: '#emit', replacement: resolve(rootDir, 'packages/emit/src') },
    {
      find: /^@open-pencil\/emit$/,
      replacement: resolve(rootDir, 'packages/emit/src/index.ts')
    },
    { find: '#design-jsx', replacement: resolve(rootDir, 'packages/design-jsx/src') },
    {
      find: /^@open-pencil\/design-jsx$/,
      replacement: resolve(rootDir, 'packages/design-jsx/src/index.ts')
    },
    { find: /^@open-pencil\/pen$/, replacement: resolve(rootDir, 'packages/pen/src/index.ts') },
    { find: '@open-pencil/pen', replacement: resolve(rootDir, 'packages/pen/src') },
    { find: /^@open-pencil\/kiwi$/, replacement: resolve(rootDir, 'packages/kiwi/src/index.ts') },
    { find: '@open-pencil/kiwi', replacement: resolve(rootDir, 'packages/kiwi/src') },
    { find: /^@open-pencil\/fig$/, replacement: resolve(rootDir, 'packages/fig/src/index.ts') },
    { find: '@open-pencil/fig', replacement: resolve(rootDir, 'packages/fig/src') },
    {
      find: /^@open-pencil\/mcp\/discovery$/,
      replacement: resolve(rootDir, 'packages/mcp/src/transport/discovery.ts')
    },
    {
      find: /^@open-pencil\/mcp\/transport$/,
      replacement: resolve(rootDir, 'packages/mcp/src/transport/paths.ts')
    },
    { find: /^@open-pencil\/vue$/, replacement: resolve(rootDir, 'packages/vue/src/index.ts') },
    { find: '@open-pencil/vue', replacement: resolve(rootDir, 'packages/vue/src') },
    // Bundled fonts ship beside the sources, not inside them.
    {
      find: /^@open-pencil\/core\/assets\//,
      replacement: `${resolve(rootDir, 'packages/core/assets')}/`
    },
    { find: /^@open-pencil\/core$/, replacement: resolve(rootDir, 'packages/core/src/index.ts') },
    { find: '@open-pencil/core', replacement: resolve(rootDir, 'packages/core/src') },
    {
      find: /^@open-pencil\/compiler$/,
      replacement: resolve(rootDir, 'packages/compiler/src/index.ts')
    },
    {
      find: /^@open-pencil\/compiler\/preview-local-backend$/,
      replacement: resolve(rootDir, 'packages/compiler/src/local-backend-preview/connection.ts')
    },
    {
      find: /^@open-pencil\/compiler\/managed-preview$/,
      replacement: resolve(rootDir, 'packages/compiler/src/managed-preview/protocol.ts')
    },
    { find: '@open-pencil/compiler', replacement: resolve(rootDir, 'packages/compiler/src') },
    {
      find: 'opentype.js',
      replacement: resolve(rootDir, 'node_modules/opentype.js/dist/opentype.mjs')
    }
  ]
}
