import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { SUPABASE_JS_VERSION } from '@open-pencil/compiler/adapters/react/lowcode-supabase'

/**
 * Phase 3 §2 — preview iframe regression (experience D).
 *
 * The lowcode preview compiles + pushes the VFS to the dev-server
 * (`packages/compiler/src/dev-server.ts`). The dev-server resolves bare
 * imports from the monorepo's hoisted `node_modules`, NOT from the
 * emitted project's `package.json` (no `npm install` ever runs on the
 * VFS). `_lowcode_supabase.ts` imports `@supabase/supabase-js`; if the
 * package isn't a `packages/compiler` devDependency it's absent from the
 * hoist target and the preview iframe goes blank for any page that fires
 * a `supabaseQuery` / `supabaseMutation` handler — while pages without
 * Supabase wiring render fine. Same asymmetry that bit zustand in §2.
 */
describe('preview can resolve @supabase/supabase-js (Phase 3 §2 regression)', () => {
  test('packages/compiler declares @supabase/supabase-js pinned to SUPABASE_JS_VERSION', () => {
    const pkgPath = join(process.cwd(), 'packages/compiler/package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const declared =
      pkg.devDependencies?.['@supabase/supabase-js'] ??
      pkg.dependencies?.['@supabase/supabase-js']
    expect(declared).toBe(SUPABASE_JS_VERSION)
  })

  test('@supabase/supabase-js actually resolves from the monorepo', async () => {
    const mod = await import('@supabase/supabase-js')
    expect(typeof mod.createClient).toBe('function')
  })
})
