import { describe, expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Ok<T = undefined> = { ok: true; data?: T }
type Err = { ok: false; error: string }
type Result<T = undefined> = Ok<T> | Err

const FAKE_ANON_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.fake'
const FAKE_SERVICE_ROLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake'

/**
 * Phase 3 §3 step 3 — lowcode modify tools.
 *
 * Three tools validate at the input boundary (decision §3.2 #h) so AI
 * cannot inject a service_role JWT, a $-prefixed reserved state name,
 * an unparseable expression, or an unknown patch field. Tests pin the
 * happy paths + every reject path that protects persistence safety.
 */

describe('update_lowcode_node', () => {
  test('returns ok:false when the id does not exist', () => {
    const { figma } = setupToolTest()
    const tool = getTool('update_lowcode_node')
    const result = tool.execute(figma, {
      id: 'missing',
      patch_json: '{}'
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('missing')
  })

  test('returns ok:false when patch_json is not valid JSON', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: rect.id,
      patch_json: '{not json'
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('JSON')
  })

  test('rejects unknown patch keys (no silent drops)', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: rect.id,
      patch_json: JSON.stringify({ bogusField: 'whatever' })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('bogusField')
  })

  test('applies a multi-field patch atomically', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        interactiveProps: { text: 'Submit' },
        events: { onClick: [{ id: 'a-1', kind: 'navigate', to: '/done' }] }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.updated.sort()).toEqual(['events', 'interactiveProps'])
    const node = graph.getNode(btn.id)
    expect(node?.interactiveProps).toEqual({ text: 'Submit' })
    expect(node?.events?.onClick?.[0]).toEqual({ id: 'a-1', kind: 'navigate', to: '/done' })
  })

  test('null in patch clears the corresponding SceneNode field', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    graph.updateNode(btn.id, {
      renderCondition: 'count > 0',
      interactiveProps: { text: 'Old' }
    })
    const result = getTool('update_lowcode_node').execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({ renderCondition: null })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const node = graph.getNode(btn.id)
    expect(node?.renderCondition).toBeUndefined()
    // interactiveProps was NOT in the patch → must stay (decision §3.2 #c).
    expect(node?.interactiveProps).toEqual({ text: 'Old' })
  })

  test('rejects a service_role JWT in lowcodeSupabaseConfig (decision §3.2 #h)', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeSupabaseConfig: {
          url: 'https://x.supabase.co',
          anonKey: FAKE_SERVICE_ROLE_JWT
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('service_role')
    expect(graph.getNode(graph.rootId)?.lowcodeSupabaseConfig).toBeUndefined()
  })

  test('rejects $-prefixed names in lowcodeDocumentState', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeDocumentState: [
          { id: 'd-1', name: '$currentUser', type: 'object', defaultValue: {} }
        ]
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('$')
  })

  test('rejects an unparseable renderCondition expression', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: rect.id,
      patch_json: JSON.stringify({ renderCondition: '!!!' })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('renderCondition')
  })

  test('rejects an action with an unknown kind', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        events: { onClick: [{ id: 'a-1', kind: 'turnIntoCoffee' }] }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('turnIntoCoffee')
  })

  test('rejects a binding with an unknown kind', () => {
    const { figma } = setupToolTest()
    const txt = figma.createText()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: txt.id,
      patch_json: JSON.stringify({
        bindings: { text: { kind: 'magic' } }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('magic')
  })

  test('accepts a valid expr binding', () => {
    const { figma, graph } = setupToolTest()
    const txt = figma.createText()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: txt.id,
      patch_json: JSON.stringify({
        bindings: { text: { kind: 'expr', expr: 'count + 1' } }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(graph.getNode(txt.id)?.bindings?.text).toEqual({ kind: 'expr', expr: 'count + 1' })
  })
})

describe('set_doc_states', () => {
  test('replaces the root docState array', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('set_doc_states').execute(figma, {
      states_json: JSON.stringify([
        { id: 'd-1', name: 'count', type: 'number', defaultValue: 0 },
        { id: 'd-2', name: 'items', type: 'array', defaultValue: [] }
      ])
    }) as Result<{ count: number }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.count).toBe(2)
    expect(graph.getNode(graph.rootId)?.lowcodeDocumentState?.length).toBe(2)
  })

  test('clears via empty array', () => {
    const { figma, graph } = setupToolTest()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd-1', name: 'count', type: 'number', defaultValue: 0 }]
    })
    const result = getTool('set_doc_states').execute(figma, {
      states_json: '[]'
    }) as Result<{ count: number }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.count).toBe(0)
    expect(graph.getNode(graph.rootId)?.lowcodeDocumentState).toEqual([])
  })

  test('rejects $-prefixed names', () => {
    const { figma } = setupToolTest()
    const result = getTool('set_doc_states').execute(figma, {
      states_json: JSON.stringify([
        { id: 'd-1', name: '$currentUser', type: 'object', defaultValue: {} }
      ])
    }) as Result<{ count: number }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('$')
  })

  test('rejects duplicate names', () => {
    const { figma } = setupToolTest()
    const result = getTool('set_doc_states').execute(figma, {
      states_json: JSON.stringify([
        { id: 'd-1', name: 'count', type: 'number', defaultValue: 0 },
        { id: 'd-2', name: 'count', type: 'number', defaultValue: 1 }
      ])
    }) as Result<{ count: number }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('duplicate')
  })

  test('rejects an unknown state type', () => {
    const { figma } = setupToolTest()
    const result = getTool('set_doc_states').execute(figma, {
      states_json: JSON.stringify([
        { id: 'd-1', name: 'x', type: 'wizard', defaultValue: null }
      ])
    }) as Result<{ count: number }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('wizard')
  })
})

describe('set_supabase_config', () => {
  test('sets a valid anon config', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('set_supabase_config').execute(figma, {
      config_json: JSON.stringify({
        url: 'https://x.supabase.co',
        anonKey: FAKE_ANON_JWT,
        schema: 'public'
      })
    }) as Result<{ cleared: boolean }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.cleared).toBe(false)
    const stored = graph.getNode(graph.rootId)?.lowcodeSupabaseConfig
    expect(stored?.url).toBe('https://x.supabase.co')
    expect(stored?.schema).toBe('public')
  })

  test('clears via JSON null', () => {
    const { figma, graph } = setupToolTest()
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: { url: 'https://x.supabase.co', anonKey: FAKE_ANON_JWT }
    })
    const result = getTool('set_supabase_config').execute(figma, {
      config_json: 'null'
    }) as Result<{ cleared: boolean }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.cleared).toBe(true)
    expect(graph.getNode(graph.rootId)?.lowcodeSupabaseConfig).toBeUndefined()
  })

  test('rejects a service_role JWT (decision §3.2 #h, mirrors editor UI)', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('set_supabase_config').execute(figma, {
      config_json: JSON.stringify({
        url: 'https://x.supabase.co',
        anonKey: FAKE_SERVICE_ROLE_JWT
      })
    }) as Result<{ cleared: boolean }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('service_role')
    expect(graph.getNode(graph.rootId)?.lowcodeSupabaseConfig).toBeUndefined()
  })

  test('rejects a url without http(s) scheme', () => {
    const { figma } = setupToolTest()
    const result = getTool('set_supabase_config').execute(figma, {
      config_json: JSON.stringify({ url: 'x.supabase.co', anonKey: FAKE_ANON_JWT })
    }) as Result<{ cleared: boolean }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.toLowerCase()).toContain('http')
  })

  test('rejects missing required url / anonKey', () => {
    const { figma } = setupToolTest()
    const result = getTool('set_supabase_config').execute(figma, {
      config_json: JSON.stringify({ url: 'https://x.supabase.co' })
    }) as Result<{ cleared: boolean }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('anonKey')
  })
})
