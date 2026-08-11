import { describe, expect, test } from 'bun:test'

import {
  inMemoryVFS,
  contentTypeForPath,
  lookupFile,
  resolveRelative,
  stripQuery,
  type PreviewFiles
} from '@open-pencil/compiler/vfs'

/**
 * Phase 3 §5 step 1: the in-memory VFS resolution helpers are shared between
 * the preview dev-server and the static build. They're pure functions, so the
 * resolution rules are pinned here (经验 K — verify what can be verified
 * deterministically; the Vite build round-trip is covered by the §5 step-2
 * smoke test + deploy ACK).
 */
describe('resolveRelative (Phase 3 §5)', () => {
  test('relative sibling resolves against importer dir', () => {
    expect(resolveRelative('./App', 'src/main.tsx')).toBe('src/App')
  })

  test('relative css import resolves against importer dir', () => {
    expect(resolveRelative('./index.css', 'src/main.tsx')).toBe('src/index.css')
  })

  test('parent-relative import normalizes up a directory', () => {
    expect(resolveRelative('../shared/x', 'src/pages/home.tsx')).toBe('src/shared/x')
  })

  test('bare specifier is returned unchanged (npm dep, not VFS)', () => {
    expect(resolveRelative('react-dom/client', 'src/main.tsx')).toBe('react-dom/client')
  })
})

describe('contentTypeForPath', () => {
  test('serves browser font assets with their standard MIME types', () => {
    expect(contentTypeForPath('src/assets/fonts/a.woff2')).toBe('font/woff2')
    expect(contentTypeForPath('src/assets/fonts/a.woff')).toBe('font/woff')
    expect(contentTypeForPath('src/assets/fonts/a.ttf')).toBe('font/ttf')
    expect(contentTypeForPath('src/assets/fonts/a.otf')).toBe('font/otf')
  })
})

describe('lookupFile (Phase 3 §5)', () => {
  const files: PreviewFiles = new Map([
    ['index.html', '<html></html>'],
    ['src/App.tsx', 'export default () => null'],
    ['src/index.css', '@import "tailwindcss";'],
    ['src/util.ts', 'export const x = 1'],
    ['src/pages/index.tsx', 'export default () => null'],
    ['src/VuePage.vue', '<template><p>Vue</p></template>']
  ])

  test('exact key hits without extension probing', () => {
    expect(lookupFile(files, 'index.html')).toBe('index.html')
  })

  test('extensionless stem resolves .tsx', () => {
    expect(lookupFile(files, 'src/App')).toBe('src/App.tsx')
  })

  test('extensionless stem resolves .ts', () => {
    expect(lookupFile(files, 'src/util')).toBe('src/util.ts')
  })

  test('extensionless stem resolves Vue SFCs', () => {
    expect(lookupFile(files, 'src/VuePage')).toBe('src/VuePage.vue')
  })

  test('extensionless stem resolves .css', () => {
    expect(lookupFile(files, 'src/index')).toBe('src/index.css')
  })

  test('directory stem falls back to index file', () => {
    expect(lookupFile(files, 'src/pages')).toBe('src/pages/index.tsx')
  })

  test('missing stem returns null (falls through to Vite resolver)', () => {
    expect(lookupFile(files, 'src/nope')).toBeNull()
  })
})

describe('stripQuery (Phase 3 §5)', () => {
  test('drops HMR cache-bust query', () => {
    expect(stripQuery('src/index.css?t=12345')).toBe('src/index.css')
  })

  test('drops asset-hint query', () => {
    expect(stripQuery('src/App.tsx?import')).toBe('src/App.tsx')
  })

  test('leaves query-less paths unchanged', () => {
    expect(stripQuery('src/App.tsx')).toBe('src/App.tsx')
  })
})

/**
 * Phase 3 §15: the shadcn UI-kit emit imports via the `@/` alias
 * (`@/components/ui/button`, `@/lib/utils`). The VFS build runs `configFile:
 * false`, so the alias the emitted vite.config declares is ignored — the VFS
 * plugin resolves `@/` → the project's `src/` itself. Without this the static
 * build / preview can't resolve any kit import. Scoped npm packages
 * (`@radix-ui/…`) must NOT be caught — they fall through to node_modules.
 */
describe('inMemoryVFS @/ alias (Phase 3 §15)', () => {
  const PREFIX = '/scan-root/'
  const files: PreviewFiles = new Map([
    ['src/components/ui/button.tsx', 'export const Button = () => null'],
    ['src/lib/utils.ts', 'export const cn = (...a: string[]) => a.join(" ")'],
    ['src/pages/index.tsx', 'export default () => null']
  ])
  const plugin = inMemoryVFS({ files }, PREFIX)
  const resolveId = plugin.resolveId as (source: string, importer?: string) => string | null

  test('`@/components/ui/button` resolves to the VFS src module', () => {
    expect(resolveId('@/components/ui/button', PREFIX + 'src/pages/index.tsx')).toBe(
      PREFIX + 'src/components/ui/button.tsx'
    )
  })

  test('`@/lib/utils` resolves to the VFS src module', () => {
    expect(resolveId('@/lib/utils')).toBe(PREFIX + 'src/lib/utils.ts')
  })

  test('a scoped npm package (@radix-ui/react-slot) is NOT aliased', () => {
    expect(resolveId('@radix-ui/react-slot', PREFIX + 'src/components/ui/button.tsx')).toBeNull()
  })

  test('an unknown @/ path returns null (no phantom module)', () => {
    expect(resolveId('@/components/ui/missing')).toBeNull()
  })
})

describe('inMemoryVFS Vue and binary modules', () => {
  const PREFIX = '/scan-root/'
  const files: PreviewFiles = new Map([
    ['src/App.vue', '<template><p>Vue</p></template>'],
    ['src/assets/pixel.png', new Uint8Array([1, 2, 3])]
  ])
  const plugin = inMemoryVFS({ files }, PREFIX)
  const load = plugin.load as (id: string) => string | null

  test('leaves plugin-vue SFC submodules to plugin-vue', () => {
    expect(load(PREFIX + 'src/App.vue')).toContain('<template>')
    expect(load(PREFIX + 'src/App.vue?vue&type=template&lang.js')).toBeNull()
  })

  test('turns imported VFS binaries into stable base-aware URL modules', () => {
    expect(load(PREFIX + 'src/assets/pixel.png')).toBe(
      'export default import.meta.env.BASE_URL + "assets/pixel.png"\n'
    )
  })
})
