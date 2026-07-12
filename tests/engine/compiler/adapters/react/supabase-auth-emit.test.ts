import { describe, expect, test } from 'bun:test'

import type { CompilerOptions } from '@open-pencil/compiler'
import { reactAdapter } from '@open-pencil/compiler/adapters/react'
import {
  buildLowcodeSupabaseRuntime,
  buildSupabaseEnvExample,
  buildViteEnvDts,
  SUPABASE_JS_VERSION
} from '@open-pencil/compiler/adapters/react/lowcode/supabase'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRSupabaseConfig } from '@open-pencil/compiler/ir/types'
import { SceneGraph } from '@open-pencil/core'
import type { SupabaseConfig } from '@open-pencil/scene-graph'

const BASE_OPTIONS: CompilerOptions = {
  packageName: 'demo',
  target: 'react',
  reactVersion: '19',
  router: 'none',
  typescript: true,
  devMode: false
}

const SAMPLE_CONFIG: SupabaseConfig = {
  url: 'https://example.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiJ9.anon.sig'
}

/**
 * Phase 3 §2 step 3 — the React adapter scaffolds `src/_lowcode_supabase.ts`
 * when (and only when) the root SceneNode carries `lowcodeSupabaseConfig`,
 * and injects `@supabase/supabase-js` into the emitted project's package.json
 * — the exact path the preview iframe / exported project both need so that
 * `import { createClient } from '@supabase/supabase-js'` resolves.
 */
describe('buildLowcodeSupabaseRuntime (Phase 3 §2)', () => {
  test('imports createClient + Session type from @supabase/supabase-js', () => {
    const out = buildLowcodeSupabaseRuntime(SAMPLE_CONFIG)
    expect(out).toContain("from '@supabase/supabase-js'")
    expect(out).toContain('createClient')
    expect(out).toContain('type Session')
  })

  test('imports setDocState + useDocState from the lowcode state runtime', () => {
    const out = buildLowcodeSupabaseRuntime(SAMPLE_CONFIG)
    expect(out).toContain("from './_lowcode_state'")
    expect(out).toContain('setDocState')
    expect(out).toContain('useDocState')
  })

  test('module-scope singleton via getSupabaseClient() (decision #h)', () => {
    const out = buildLowcodeSupabaseRuntime(SAMPLE_CONFIG)
    expect(out).toContain('export function getSupabaseClient()')
    expect(out).toContain('let _client')
    expect(out).toContain('const supabase = getSupabaseClient()')
  })

  test('useSupabaseAuth() hook is exported and reads $currentUser', () => {
    const out = buildLowcodeSupabaseRuntime(SAMPLE_CONFIG)
    expect(out).toContain('export function useSupabaseAuth()')
    expect(out).toContain("useDocState('$currentUser')")
    expect(out).toContain('signInWithPassword')
    expect(out).toContain('signOut')
  })

  test('bootstraps $currentUser from getSession() + keeps in sync via onAuthStateChange', () => {
    const out = buildLowcodeSupabaseRuntime(SAMPLE_CONFIG)
    expect(out).toContain('supabase.auth.getSession()')
    expect(out).toContain('supabase.auth.onAuthStateChange')
    // Both bootstrap paths write into the same locked docState key.
    const writeCount = out.match(/setDocState\('\$currentUser',/g)?.length ?? 0
    expect(writeCount).toBe(2)
  })

  test('$currentUser shape mirrors the locked schema (id / email / signedIn)', () => {
    const out = buildLowcodeSupabaseRuntime(SAMPLE_CONFIG)
    // toCurrentUser shape — keys are the contract emitted into the snapshot.
    expect(out).toContain('id: session?.user.id ?? null')
    expect(out).toContain('email: session?.user.email ?? null')
    expect(out).toContain('signedIn: !!session')
  })

  test('url + anonKey are JSON.stringified so quotes / backslashes survive', () => {
    const tricky: IRSupabaseConfig = {
      url: 'https://a"b.supabase.co',
      anonKey: 'a\\b"c'
    }
    const out = buildLowcodeSupabaseRuntime(tricky)
    // JSON.stringify escapes both — the values stay single valid string
    // literals in the import.meta.env fallback (§5).
    expect(out).toContain('"https://a\\"b.supabase.co"')
    expect(out).toContain('"a\\\\b\\"c"')
    expect(out).toContain('import.meta.env.VITE_SUPABASE_URL ?? "https://a\\"b.supabase.co"')
  })

  test('§5: connection reads import.meta.env with the design-time values as fallback', () => {
    const out = buildLowcodeSupabaseRuntime(SAMPLE_CONFIG)
    expect(out).toContain(
      'const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://example.supabase.co"'
    )
    expect(out).toContain(
      'const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiJ9.anon.sig"'
    )
    // createClient now takes the resolved consts, not inline literals.
    expect(out).toContain('createClient(SUPABASE_URL, SUPABASE_ANON_KEY)')
  })
})

describe('React adapter — emit lowcode Supabase runtime + dep inject (Phase 3 §2)', () => {
  test('document with no supabaseConfig → no _lowcode_supabase.ts, no supabase-js in deps (zero regression)', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const irs = [collectTree(graph, pageId)]
    const out = reactAdapter.emit(irs, BASE_OPTIONS)
    expect(out.files.has('src/_lowcode_supabase.ts')).toBe(false)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies['@supabase/supabase-js']).toBeUndefined()
  })

  test('invalid imported supabaseConfig warns and skips runtime emit', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: {
        url: ['java', 'script:alert(1)'].join(''),
        anonKey: SAMPLE_CONFIG.anonKey
      }
    })

    const ir = collectTree(graph, pageId)
    const out = reactAdapter.emit([ir], BASE_OPTIONS)
    const pkg = JSON.parse(out.files.get('package.json') as string)

    expect(ir.supabaseConfig).toBeUndefined()
    expect(ir.docStates.some((state) => state.name === '$currentUser')).toBe(false)
    expect(ir.warnings).toContainEqual(
      expect.objectContaining({
        code: 'supabase-config-invalid'
      })
    )
    expect(out.files.has('src/_lowcode_supabase.ts')).toBe(false)
    expect(pkg.dependencies['@supabase/supabase-js']).toBeUndefined()
  })

  test('document with supabaseConfig (single-page) → emits _lowcode_supabase.ts + supabase-js dep', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: SAMPLE_CONFIG })
    const pageId = graph.getPages()[0].id
    const irs = [collectTree(graph, pageId)]
    const out = reactAdapter.emit(irs, BASE_OPTIONS)

    expect(out.files.has('src/_lowcode_supabase.ts')).toBe(true)
    const runtime = out.files.get('src/_lowcode_supabase.ts') as string
    expect(runtime).toContain('https://example.supabase.co')

    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies['@supabase/supabase-js']).toBe(SUPABASE_JS_VERSION)
  })

  test('§5: supabaseConfig → emits vite-env.d.ts + .env.example (env override scaffold)', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: SAMPLE_CONFIG })
    const pageId = graph.getPages()[0].id
    const out = reactAdapter.emit([collectTree(graph, pageId)], BASE_OPTIONS)

    expect(out.files.get('src/vite-env.d.ts')).toContain('vite/client')
    const envExample = out.files.get('.env.example') as string
    expect(envExample).toContain('VITE_SUPABASE_URL=https://example.supabase.co')
    expect(envExample).toContain('VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.anon.sig')
  })

  test('§5: no supabaseConfig → no vite-env.d.ts / .env.example (scaffold gated on config)', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const out = reactAdapter.emit([collectTree(graph, pageId)], BASE_OPTIONS)
    expect(out.files.has('src/vite-env.d.ts')).toBe(false)
    expect(out.files.has('.env.example')).toBe(false)
  })

  test('§5: scaffold builders produce vite/client ref + a copy-to-.env template', () => {
    expect(buildViteEnvDts()).toContain('/// <reference types="vite/client" />')
    const example = buildSupabaseEnvExample(SAMPLE_CONFIG)
    expect(example).toContain('VITE_SUPABASE_URL=https://example.supabase.co')
    expect(example).toContain('Copy this file to .env')
  })

  test('supabaseConfig auto-prepends $currentUser → _lowcode_state.ts is also emitted (zustand chained in)', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: SAMPLE_CONFIG })
    const pageId = graph.getPages()[0].id
    const irs = [collectTree(graph, pageId)]
    const out = reactAdapter.emit(irs, BASE_OPTIONS)

    // The Supabase runtime imports from './_lowcode_state' — so once the
    // root carries supabaseConfig both runtimes must coexist or the emitted
    // module can't resolve `setDocState` / `useDocState`.
    expect(out.files.has('src/_lowcode_state.ts')).toBe(true)
    const state = out.files.get('src/_lowcode_state.ts') as string
    expect(state).toContain('$currentUser')
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies.zustand).toBeDefined()
  })

  test('multi-page document with supabaseConfig → runtime is emitted once + dep injected alongside react-router-dom', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: SAMPLE_CONFIG })
    graph.addPage('About')
    const irs = graph.getPages().map((p) => collectTree(graph, p.id))
    const out = reactAdapter.emit(irs, BASE_OPTIONS)

    expect(out.files.has('src/_lowcode_supabase.ts')).toBe(true)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies['@supabase/supabase-js']).toBe(SUPABASE_JS_VERSION)
    expect(pkg.dependencies['react-router-dom']).toBeDefined()
  })
})
