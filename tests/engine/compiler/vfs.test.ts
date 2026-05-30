import { describe, expect, test } from 'bun:test'

import { lookupFile, resolveRelative, stripQuery, type PreviewFiles } from '@open-pencil/compiler/vfs'

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

describe('lookupFile (Phase 3 §5)', () => {
  const files: PreviewFiles = new Map([
    ['index.html', '<html></html>'],
    ['src/App.tsx', 'export default () => null'],
    ['src/index.css', '@import "tailwindcss";'],
    ['src/util.ts', 'export const x = 1'],
    ['src/pages/index.tsx', 'export default () => null']
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
