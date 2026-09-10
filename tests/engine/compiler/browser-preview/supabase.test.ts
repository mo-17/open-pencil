import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildBrowserPreview } from '@open-pencil/compiler/browser-preview'
import { findCodePenSecretKinds } from '@open-pencil/lowcode'
import { SceneGraph } from '@open-pencil/scene-graph'

import { browserPreviewInput } from './helpers'

function fakeLegacyKey(role: 'anon' | 'service_role'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url')
  return `${header}.${payload}.fake_signature`
}

// Deliberately fake key-shaped values exercise the existing secret boundary.
const ELEVATED_KEYS = [
  ['secret key', `sb_secret_${'a'.repeat(32)}`],
  ['management token', `sbp_${'b'.repeat(40)}`],
  ['legacy service role', fakeLegacyKey('service_role')]
] as const

function compileSupabasePreview() {
  const graph = new SceneGraph()
  graph.updateNode(graph.rootId, {
    lowcodeSupabaseConfig: {
      url: 'https://example.supabase.co',
      anonKey: 'browser-preview-public-placeholder'
    }
  })
  const { files } = compile({
    graph,
    pageIds: [graph.getPages()[0].id],
    options: withDefaults({ packageName: 'browser-preview-supabase-test', devMode: true })
  })
  const runtime = files.get('src/_lowcode_supabase.ts')
  if (typeof runtime !== 'string') throw new Error('Missing generated Supabase runtime')
  return { files, runtime }
}

function generatedKeyGuard(runtime: string): (value: string) => string {
  const start = runtime.indexOf('function legacySupabaseRole(')
  const end = runtime.indexOf('const SUPABASE_PUBLISHABLE_KEY =')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  // Execute the emitted pure guards without loading Supabase or starting auth IO.
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(runtime.slice(start, end))
  return new Function(`${javascript}\nreturn assertSupabasePublicKey`)() as (
    value: string
  ) => string
}

describe('generated Supabase runtime browser preview boundary', () => {
  test('does not mistake the generated public-key guard for an embedded secret', () => {
    const { runtime } = compileSupabasePreview()
    expect(findCodePenSecretKinds(runtime)).toEqual([])
  })

  test('the emitted guard still rejects elevated opaque keys and service-role JWTs', () => {
    const { runtime } = compileSupabasePreview()
    const guard = generatedKeyGuard(runtime)
    const publicKeys = ['browser-preview-public-placeholder', `sb_publishable_${'c'.repeat(32)}`]
    for (const key of [...publicKeys, fakeLegacyKey('anon')]) {
      expect(guard(` ${key} `)).toBe(key)
    }
    for (const key of [...ELEVATED_KEYS.map(([, key]) => key), 'sb_secret_', 'sbp_']) {
      expect(() => guard(` ${key} `)).toThrow('invalid or elevated key')
    }
    for (const [, key] of ELEVATED_KEYS.slice(0, 2)) {
      expect(() => guard(key.toUpperCase())).toThrow('invalid or elevated key')
    }
    expect(() => guard(' ')).toThrow('invalid or elevated key')
  })

  test('retains the explicit networking restriction after generated source passes scanning', async () => {
    const { files } = compileSupabasePreview()
    const input = await browserPreviewInput(files)
    const stages: string[] = []
    input.onStage = (stage) => stages.push(stage)
    const result = await buildBrowserPreview(input)
    expect(result.status).toBe('error')
    expect(result.diagnostics[0]).toMatchObject({
      code: 'browser-preview-network-runtime-unsupported',
      path: 'src/_lowcode_supabase.ts'
    })
    expect(result.diagnostics.some((item) => item.code === 'browser-preview-secret-detected')).toBe(
      false
    )
    expect(stages).toEqual(['bundle-validate'])
  })

  test.each(ELEVATED_KEYS)(
    'still blocks a real-shaped fake %s in generated source',
    async (_, key) => {
      const { files, runtime } = compileSupabasePreview()
      const source = `${runtime}\nexport const leakedValue = ${JSON.stringify(key)}\n`
      expect(findCodePenSecretKinds(source)).toContain('a Supabase elevated key')
      files.set('src/_lowcode_supabase.ts', source)
      const result = await buildBrowserPreview(await browserPreviewInput(files))
      expect(result.status).toBe('error')
      expect(result.diagnostics[0]).toMatchObject({
        code: 'browser-preview-secret-detected',
        path: 'src/_lowcode_supabase.ts'
      })
    }
  )
})
