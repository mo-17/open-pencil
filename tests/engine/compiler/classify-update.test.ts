import { describe, expect, test } from 'bun:test'

import { classifyUpdate } from '@open-pencil/compiler/dev-server'

/**
 * Phase 1 §10: dev-server splits VFS updates into three modes so the iframe
 * can preserve React state across edits whenever possible.
 */
describe('classifyUpdate (Phase 1 §10)', () => {
  test('no changes → noop', () => {
    expect(classifyUpdate([], 0)).toBe('noop')
  })

  test('index.html changed → full-reload (SPA entry can never HMR)', () => {
    expect(classifyUpdate(['index.html'], 1)).toBe('full-reload')
  })

  test('zero invalidations → full-reload (VFS has no module to swap)', () => {
    expect(classifyUpdate(['src/App.tsx'], 0)).toBe('full-reload')
  })

  test('a mixed mapped/unmapped batch → full-reload (new imports need evaluation)', () => {
    expect(classifyUpdate(['src/main.tsx', 'src/__motion-runtime.ts'], 1)).toBe('full-reload')
  })

  test('an added or removed module → full-reload even when Vite still maps every path', () => {
    expect(classifyUpdate(['src/main.tsx', 'src/__motion-runtime.ts'], 2, true)).toBe('full-reload')
  })

  test('only .tsx changed and invalidated → hmr', () => {
    expect(classifyUpdate(['src/App.tsx'], 1)).toBe('hmr')
  })

  test('index.html alongside other changes still forces full-reload', () => {
    expect(classifyUpdate(['src/App.tsx', 'index.html'], 2)).toBe('full-reload')
  })

  test('multiple module updates → hmr', () => {
    expect(classifyUpdate(['src/App.tsx', 'src/index.css'], 2)).toBe('hmr')
  })
})
