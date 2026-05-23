import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { ZUSTAND_VERSION } from '@open-pencil/compiler/adapters/react/lowcode-state'

/**
 * Phase 2 §2 — Tauri-test regression.
 *
 * The lowcode preview (`use-compile-on-change.ts`) compiles single-page and
 * pushes the VFS to the dev-server (`packages/compiler/src/dev-server.ts`).
 * The dev-server resolves bare imports — `react`, `zustand/vanilla` — from
 * the monorepo's hoisted `node_modules`, NOT from the emitted project's
 * `package.json` (no `npm install` ever runs on the VFS).
 *
 * `_lowcode_state.ts` imports `zustand` / `zustand/vanilla`. If `zustand`
 * is not a `packages/compiler` dependency it is absent from `node_modules`
 * and the preview iframe renders blank for any page that reads a Document
 * State — while literal-text pages render fine (no zustand import). That is
 * exactly the asymmetry this test guards against: `react` / `react-dom` are
 * compiler devDependencies for the same reason, and `zustand` must be too.
 */
describe('preview can resolve zustand (Phase 2 §2 regression)', () => {
  test('packages/compiler declares zustand pinned to ZUSTAND_VERSION', () => {
    const pkgPath = join(process.cwd(), 'packages/compiler/package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const declared = pkg.devDependencies?.zustand ?? pkg.dependencies?.zustand
    // Same pin the React adapter injects into emitted projects, so the
    // preview-resolvable copy and the exported-project copy never diverge.
    expect(declared).toBe(ZUSTAND_VERSION)
  })

  test('zustand and zustand/vanilla actually resolve from the monorepo', async () => {
    // The dev-server imports exactly these two specifiers via the emitted
    // `_lowcode_state.ts`; proving they import here proves the preview can.
    const root = await import('zustand')
    const vanilla = await import('zustand/vanilla')
    expect(typeof root.useStore).toBe('function')
    expect(typeof vanilla.createStore).toBe('function')
  })
})
