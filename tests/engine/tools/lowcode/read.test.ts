import { describe, expect, test } from 'bun:test'

import type { LowcodeNodeRead } from '@open-pencil/core/tools'
import type { ActionDef, DocumentStateDef, SupabaseConfig } from '@open-pencil/scene-graph'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Phase 3 §3 step 2 — lowcode read tools surface the SceneNode lowcode
 * fields + the root-only documentState / supabaseConfig snapshots to AI
 * agents (chat + MCP + CLI eval all see them by virtue of ALL_TOOLS).
 * These tests pin the shape, the "never configured → field omitted"
 * convention, and the null / empty-array fallbacks that callers branch on.
 */

describe('read_lowcode_node', () => {
  test('returns id / type / name / layoutMode on a node with no lowcode wiring', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()
    const tool = getTool('read_lowcode_node')
    const result = tool.execute(figma, { id: rect.id }) as Result<LowcodeNodeRead>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.id).toBe(rect.id)
    expect(result.data.type).toBe('RECTANGLE')
    // Fields never configured stay omitted so AI can tell apart "no events
    // set" from "events set to an empty list" (both equally valid states).
    expect(result.data.events).toBeUndefined()
    expect(result.data.bindings).toBeUndefined()
    expect(result.data.interactiveProps).toBeUndefined()
    expect(result.data.renderCondition).toBeUndefined()
    expect(result.data.state).toBeUndefined()
  })

  test('returns lowcode fields that are set on the node', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const actions: ActionDef[] = [{ id: 'a-1', kind: 'navigate', to: '/next' }]
    graph.updateNode(btn.id, {
      interactiveProps: { text: 'Click me' },
      events: { onClick: actions },
      renderCondition: 'count > 0',
      stateOverrides: { hover: { opacity: 0.9 } }
    })
    const tool = getTool('read_lowcode_node')
    const result = tool.execute(figma, { id: btn.id }) as Result<LowcodeNodeRead>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.interactiveProps).toEqual({ text: 'Click me' })
    expect(result.data.events?.onClick).toEqual(actions)
    expect(result.data.renderCondition).toBe('count > 0')
    expect(result.data.stateOverrides).toEqual({ hover: { opacity: 0.9 } })
  })

  test('returns root-only fields when reading the root node', () => {
    const { figma, graph } = setupToolTest()
    const docStates: DocumentStateDef[] = [
      { id: 'd-1', name: 'count', type: 'number', defaultValue: 0 }
    ]
    const config: SupabaseConfig = {
      url: 'https://x.supabase.co',
      anonKey: 'eyJ.anon.sig'
    }
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: docStates,
      lowcodeSupabaseConfig: config,
      lowcodeSeoMetadata: { title: 'Launch', description: 'Fast page' },
      lowcodeAnalyticsConfig: {
        provider: 'ga4',
        id: 'G-TEST123',
        respectDoNotTrack: true,
        consentRegionPreset: 'eea',
        consentRequired: true,
        consentAnalyticsDefault: false,
        consentCopy: {
          bannerText: 'Acme uses analytics.',
          analyticsDescription: 'Optional analytics only.',
          privacyPolicyUrl: '/privacy',
          privacyPolicyLabel: 'Privacy notice'
        }
      },
      lowcodeHeadMetadata: {
        meta: [{ kind: 'name', key: 'theme-color', content: '#111827' }],
        link: [{ rel: 'preconnect', href: 'https://cdn.example.com' }],
        styles: [':root { color-scheme: light; }']
      },
      lowcodeCustomCss: 'body { scroll-behavior: smooth; }'
    })
    const tool = getTool('read_lowcode_node')
    const result = tool.execute(figma, { id: graph.rootId }) as Result<LowcodeNodeRead>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.lowcodeDocumentState).toEqual(docStates)
    expect(result.data.lowcodeSupabaseConfig).toEqual(config)
    expect(result.data.lowcodeSeoMetadata).toEqual({
      title: 'Launch',
      description: 'Fast page'
    })
    expect(result.data.lowcodeAnalyticsConfig).toEqual({
      provider: 'ga4',
      id: 'G-TEST123',
      respectDoNotTrack: true,
      consentRegionPreset: 'eea',
      consentRequired: true,
      consentAnalyticsDefault: false,
      consentCopy: {
        bannerText: 'Acme uses analytics.',
        analyticsDescription: 'Optional analytics only.',
        privacyPolicyUrl: '/privacy',
        privacyPolicyLabel: 'Privacy notice'
      }
    })
    expect(result.data.lowcodeHeadMetadata).toEqual({
      meta: [{ kind: 'name', key: 'theme-color', content: '#111827' }],
      link: [{ rel: 'preconnect', href: 'https://cdn.example.com' }],
      styles: [':root { color-scheme: light; }']
    })
    expect(result.data.lowcodeCustomCss).toBe('body { scroll-behavior: smooth; }')
  })

  test('returns ok:false with a descriptive error when the id is missing', () => {
    const { figma } = setupToolTest()
    const tool = getTool('read_lowcode_node')
    const result = tool.execute(figma, { id: 'does-not-exist' }) as Result<LowcodeNodeRead>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('does-not-exist')
  })

  test('is non-recursive: child lowcode fields are not included in parent read', () => {
    const { figma, graph } = setupToolTest()
    const parent = figma.createFrame()
    const child = figma.createRectangle()
    parent.appendChild(child)
    graph.updateNode(child.id, { interactiveProps: { text: 'child' } })
    const tool = getTool('read_lowcode_node')
    const result = tool.execute(figma, { id: parent.id }) as Result<LowcodeNodeRead>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Parent has no own lowcode wiring; child's interactiveProps must NOT
    // leak into the parent read — AI is expected to walk children itself.
    expect(result.data.interactiveProps).toBeUndefined()
    expect(JSON.stringify(result.data)).not.toContain('child')
  })
})

describe('read_doc_states', () => {
  test('returns empty array when root has no documentState set', () => {
    const { figma } = setupToolTest()
    const tool = getTool('read_doc_states')
    const result = tool.execute(figma, {}) as Result<DocumentStateDef[]>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual([])
  })

  test('returns the full array when root has documentState set', () => {
    const { figma, graph } = setupToolTest()
    const docStates: DocumentStateDef[] = [
      { id: 'd-1', name: 'count', type: 'number', defaultValue: 0 },
      { id: 'd-2', name: 'items', type: 'array', defaultValue: [] }
    ]
    graph.updateNode(graph.rootId, { lowcodeDocumentState: docStates })
    const tool = getTool('read_doc_states')
    const result = tool.execute(figma, {}) as Result<DocumentStateDef[]>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual(docStates)
  })
})

describe('read_supabase_config', () => {
  test('returns null data when supabaseConfig is unset (single-shape ok contract)', () => {
    const { figma } = setupToolTest()
    const tool = getTool('read_supabase_config')
    const result = tool.execute(figma, {}) as Result<SupabaseConfig | null>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toBeNull()
  })

  test('returns the full SupabaseConfig including anon key (no redaction inside the trust boundary)', () => {
    const { figma, graph } = setupToolTest()
    const config: SupabaseConfig = {
      url: 'https://abc.supabase.co',
      anonKey: 'eyJ.anon.signature',
      schema: 'public'
    }
    graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: config })
    const tool = getTool('read_supabase_config')
    const result = tool.execute(figma, {}) as Result<SupabaseConfig | null>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual(config)
  })
})
