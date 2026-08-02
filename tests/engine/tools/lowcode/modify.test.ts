/* eslint-disable max-lines -- public lowcode mutation boundary coverage stays grouped by tool */
import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string }

const FAKE_ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.fake'
const FAKE_SERVICE_ROLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake'
const CHECKOUT_ENDPOINT = `/api/\${priceId}/checkout`

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

  test('accepts lowcodeSeoMetadata and trims empty fields', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeSeoMetadata: {
          title: '  Launch  ',
          description: 'Fast page',
          image: ''
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.updated).toEqual(['lowcodeSeoMetadata'])
    expect(graph.getNode(graph.rootId)?.lowcodeSeoMetadata).toEqual({
      title: 'Launch',
      description: 'Fast page'
    })
  })

  test('rejects malformed lowcodeSeoMetadata keys', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeSeoMetadata: { canonicalURL: 'https://example.com' }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('canonicalURL')
    expect(graph.getNode(graph.rootId)?.lowcodeSeoMetadata).toBeUndefined()
  })

  test('accepts analytics privacy gates', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeAnalyticsConfig: {
          provider: 'ga4',
          id: ' G-TEST123 ',
          pageViews: false,
          respectDoNotTrack: true,
          consentRegionPreset: 'eea',
          consentRequired: true,
          consentAnalyticsDefault: false,
          consentCopy: {
            bannerText: ' Acme uses analytics. ',
            analyticsDescription: ' Optional analytics only. ',
            privacyPolicyUrl: ' /privacy ',
            privacyPolicyLabel: ' Privacy notice '
          }
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.updated).toEqual(['lowcodeAnalyticsConfig'])
    expect(graph.getNode(graph.rootId)?.lowcodeAnalyticsConfig).toEqual({
      provider: 'ga4',
      id: 'G-TEST123',
      pageViews: false,
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
  })

  test('rejects unknown analytics consent region presets', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeAnalyticsConfig: {
          provider: 'ga4',
          id: 'G-TEST123',
          consentRegionPreset: 'worldwide'
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('consentRegionPreset')
    expect(graph.getNode(graph.rootId)?.lowcodeAnalyticsConfig).toBeUndefined()
  })

  test('rejects unsafe analytics consent policy URLs', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeAnalyticsConfig: {
          provider: 'ga4',
          id: 'G-TEST123',
          consentRequired: true,
          consentCopy: {
            privacyPolicyUrl: `java${'script'}:alert(1)`
          }
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('privacyPolicyUrl')
    expect(graph.getNode(graph.rootId)?.lowcodeAnalyticsConfig).toBeUndefined()
  })

  test('rejects unsafe analytics endpoint URLs', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeAnalyticsConfig: {
          provider: 'plausible',
          id: 'example.com',
          endpoint: `java${'script'}:alert(1)`
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('endpoint')
    expect(graph.getNode(graph.rootId)?.lowcodeAnalyticsConfig).toBeUndefined()
  })

  test('accepts controlled lowcodeHeadMetadata and custom CSS', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeHeadMetadata: {
          meta: [{ kind: 'name', key: '  theme-color ', content: ' #111827 ' }],
          link: [
            {
              rel: ' stylesheet ',
              href: ' https://cdn.example.com/theme.css ',
              crossorigin: 'anonymous'
            }
          ],
          styles: [' :root { color-scheme: light; } ']
        },
        lowcodeCustomCss: ' body { scroll-behavior: smooth; } '
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.updated.sort()).toEqual(['lowcodeCustomCss', 'lowcodeHeadMetadata'])
    expect(graph.getNode(graph.rootId)?.lowcodeHeadMetadata).toEqual({
      meta: [{ kind: 'name', key: 'theme-color', content: '#111827' }],
      link: [
        {
          rel: 'stylesheet',
          href: 'https://cdn.example.com/theme.css',
          crossorigin: 'anonymous'
        }
      ],
      styles: [':root { color-scheme: light; }']
    })
    expect(graph.getNode(graph.rootId)?.lowcodeCustomCss).toBe('body { scroll-behavior: smooth; }')
  })

  test('rejects unsafe or malformed lowcodeHeadMetadata', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeHeadMetadata: {
          script: ['alert(1)'],
          meta: [{ kind: 'script', key: 'x', content: 'y' }]
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('script')
    expect(graph.getNode(graph.rootId)?.lowcodeHeadMetadata).toBeUndefined()
  })

  test('rejects unsafe lowcodeHeadMetadata link href protocols', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeHeadMetadata: {
          link: [{ rel: 'stylesheet', href: `java${'script'}:alert(1)` }]
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('href')
    expect(graph.getNode(graph.rootId)?.lowcodeHeadMetadata).toBeUndefined()
  })

  test('rejects unsafe lowcodeHeadMetadata meta refresh URL protocols', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeHeadMetadata: {
          meta: [
            {
              kind: 'httpEquiv',
              key: 'refresh',
              content: `0;url=${`java${'script'}:alert(1)`}`
            }
          ]
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('refresh')
    expect(graph.getNode(graph.rootId)?.lowcodeHeadMetadata).toBeUndefined()
  })

  test('rejects unsafe lowcodeHeadMetadata style URL protocols', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeHeadMetadata: {
          styles: [`.hero { background-image: url(${`java${'script'}:alert(1)`}); }`]
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('styles')
    expect(graph.getNode(graph.rootId)?.lowcodeHeadMetadata).toBeUndefined()
  })

  test('rejects unsafe lowcodeCustomCss URL protocols', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({
        lowcodeCustomCss: `.hero { background-image: url(${`java${'script'}:alert(1)`}); }`
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('lowcodeCustomCss')
    expect(graph.getNode(graph.rootId)?.lowcodeCustomCss).toBeUndefined()
  })

  test('preserves canonical stateOverrides paint objects', () => {
    const { figma, graph } = setupToolTest()
    const rect = figma.createRectangle()
    const stateOverrides = {
      hover: {
        opacity: 0.85,
        cornerRadius: 8,
        fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
        strokes: [
          {
            color: { r: 0, g: 0, b: 0, a: 1 },
            weight: 2,
            opacity: 0.75,
            visible: true,
            align: 'CENTER',
            cap: 'ROUND'
          }
        ]
      },
      active: { effects: [] }
    }
    const result = getTool('update_lowcode_node').execute(figma, {
      id: rect.id,
      patch_json: JSON.stringify({ stateOverrides })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.updated).toEqual(['stateOverrides'])
    expect(graph.getNode(rect.id)?.stateOverrides).toEqual(stateOverrides)
  })

  test('normalizes solid fill and stroke shorthands in stateOverrides', () => {
    const { figma, graph } = setupToolTest()
    const rect = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: rect.id,
      patch_json: JSON.stringify({
        stateOverrides: {
          hover: {
            fills: [{ color: '#E23B32' }],
            strokes: [
              { type: 'SOLID', color: '#336699', weight: 2, opacity: 0.6, align: 'OUTSIDE' }
            ]
          }
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const hover = graph.getNode(rect.id)?.stateOverrides?.hover
    expect(hover?.fills?.[0]).toEqual({
      type: 'SOLID',
      color: { r: 226 / 255, g: 59 / 255, b: 50 / 255, a: 1 },
      opacity: 1,
      visible: true
    })
    expect(hover?.strokes?.[0]).toEqual({
      color: { r: 51 / 255, g: 102 / 255, b: 153 / 255, a: 1 },
      weight: 2,
      opacity: 0.6,
      visible: true,
      align: 'OUTSIDE'
    })
  })

  test('rejects malformed stateOverrides paint shorthands with an indexed path', () => {
    const { figma, graph } = setupToolTest()
    const rect = figma.createRectangle()
    const invalidFill = getTool('update_lowcode_node').execute(figma, {
      id: rect.id,
      patch_json: JSON.stringify({ stateOverrides: { hover: { fills: [{ color: 'nope' }] } } })
    }) as Result<{ id: string; updated: string[] }>
    expect(invalidFill.ok).toBe(false)
    if (!invalidFill.ok) expect(invalidFill.error).toContain('stateOverrides.hover.fills[0].color')

    const invalidStroke = getTool('update_lowcode_node').execute(figma, {
      id: rect.id,
      patch_json: JSON.stringify({
        stateOverrides: { hover: { strokes: [{ color: '#ffffff', weight: -1 }] } }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(invalidStroke.ok).toBe(false)
    if (!invalidStroke.ok) {
      expect(invalidStroke.error).toContain('stateOverrides.hover.strokes[0].weight')
    }
    expect(graph.getNode(rect.id)?.stateOverrides).toBeUndefined()
  })

  test('rejects malformed stateOverrides', () => {
    const { figma } = setupToolTest()
    const rect = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: rect.id,
      patch_json: JSON.stringify({ stateOverrides: { groupHover: { opacity: 0.5 } } })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('groupHover')
  })

  // Phase 4 §16.2 — navigate route params validate at the tool boundary.
  test('accepts a navigate with valid route params (round-trips onto the node)', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        events: {
          onClick: [{ id: 'a-1', kind: 'navigate', to: '/product/:id', params: { id: 'pid' } }]
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual({
      id: 'a-1',
      kind: 'navigate',
      to: '/product/:id',
      params: { id: 'pid' }
    })
  })

  test('rejects a navigate param with a non-identifier key', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        events: {
          onClick: [{ id: 'a-1', kind: 'navigate', to: '/p/:id', params: { '1bad': 'pid' } }]
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('1bad')
  })

  test('rejects a navigate param with an unparseable value expression', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        events: { onClick: [{ id: 'a-1', kind: 'navigate', to: '/p/:id', params: { id: '1 +' } }] }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('params.id')
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

  // Phase 3 §3.v7 — DATEPICKER date-field format validation at the tool
  // boundary (decision f: malformed dates hard-fail; range = warn-and-keep at IR).
  test('rejects a DATEPICKER with a malformed value or min/max', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id
    const dp = graph.createNode('DATEPICKER', pageId)
    const run = (ip: Record<string, unknown>) =>
      getTool('update_lowcode_node').execute(figma, {
        id: dp.id,
        patch_json: JSON.stringify({ interactiveProps: ip })
      }) as Result<{ id: string; updated: string[] }>
    expect((run({ value: '2026-13-45' }) as { ok: false; error: string }).error).toContain('value')
    expect((run({ min: 'soon' }) as { ok: false; error: string }).error).toContain('min')
    expect((run({ max: '2026-02-30' }) as { ok: false; error: string }).error).toContain('max')
  })

  test('accepts valid value + min + max; inverted range is warn-and-keep (not a tool error)', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id
    const dp = graph.createNode('DATEPICKER', pageId)
    const run = (ip: Record<string, unknown>) =>
      getTool('update_lowcode_node').execute(figma, {
        id: dp.id,
        patch_json: JSON.stringify({ interactiveProps: ip })
      }) as Result<{ id: string; updated: string[] }>
    expect(run({ value: '2026-06-15', min: '2026-01-01', max: '2026-12-31' }).ok).toBe(true)
    expect(graph.getNode(dp.id)?.interactiveProps).toEqual({
      value: '2026-06-15',
      min: '2026-01-01',
      max: '2026-12-31'
    })
    // decision f: range relationships don't hard-fail at the tool boundary
    expect(run({ min: '2026-12-31', max: '2026-01-01' }).ok).toBe(true)
  })

  test('rejects known interactiveProps type mismatches without mutating nodes', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id
    const cases = [
      ['BUTTON', { text: 42 }, 'interactiveProps.text'],
      ['INPUT', { placeholder: false }, 'interactiveProps.placeholder'],
      ['TEXTAREA', { value: [] }, 'interactiveProps.value'],
      ['SELECT', { options: ['Admin', 7] }, 'interactiveProps.options'],
      ['RADIO', { groupName: true }, 'interactiveProps.groupName'],
      ['CHECKBOX', { checked: 'yes' }, 'interactiveProps.checked'],
      ['SWITCH', { checked: 1 }, 'interactiveProps.checked'],
      ['DATEPICKER', { min: false }, 'interactiveProps.min']
    ] as const

    for (const [nodeType, interactiveProps, expectedPath] of cases) {
      const node = graph.createNode(nodeType, pageId)
      const before = structuredClone(node.interactiveProps)
      const result = getTool('update_lowcode_node').execute(figma, {
        id: node.id,
        patch_json: JSON.stringify({ interactiveProps })
      }) as Result<{ id: string; updated: string[] }>

      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.error).toContain(expectedPath)
      expect(graph.getNode(node.id)?.interactiveProps).toEqual(before)
    }
  })

  test('accepts valid form validation and summary interactiveProps (§19)', () => {
    const { figma, graph } = setupToolTest()
    const input = figma.createRectangle()
    const validation = {
      required: true,
      pattern: '^[^@]+@[^@]+$',
      minLength: 5,
      customExpr: 'email !== "blocked@x.com"',
      messages: {
        required: 'Email required',
        pattern: 'Invalid email',
        custom: 'Blocked email'
      },
      async: {
        urlExpr: 'validatorUrl',
        method: 'GET',
        message: 'Remote validation failed'
      }
    }
    const result = getTool('update_lowcode_node').execute(figma, {
      id: input.id,
      patch_json: JSON.stringify({
        interactiveProps: {
          validation,
          validationSummary: { enabled: true, title: 'Fix these fields' },
          text: 'Submit'
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(graph.getNode(input.id)?.interactiveProps).toEqual({
      validation,
      validationSummary: { enabled: true, title: 'Fix these fields' },
      text: 'Submit'
    })
  })

  test('rejects malformed validation configs at the tool boundary (§19)', () => {
    const { figma } = setupToolTest()
    const input = figma.createRectangle()
    const run = (validation: Record<string, unknown>) =>
      getTool('update_lowcode_node').execute(figma, {
        id: input.id,
        patch_json: JSON.stringify({ interactiveProps: { validation } })
      }) as Result<{ id: string; updated: string[] }>

    expect((run({ pattern: '([unbalanced' }) as { ok: false; error: string }).error).toContain(
      'pattern'
    )
    expect((run({ minLength: '5' }) as { ok: false; error: string }).error).toContain('minLength')
    expect((run({ customExpr: 'email !==' }) as { ok: false; error: string }).error).toContain(
      'customExpr'
    )
    expect((run({ typo: true }) as { ok: false; error: string }).error).toContain('typo')
  })

  test('rejects malformed async validation configs at the tool boundary (§19)', () => {
    const { figma } = setupToolTest()
    const input = figma.createRectangle()
    const run = (async: Record<string, unknown>) =>
      getTool('update_lowcode_node').execute(figma, {
        id: input.id,
        patch_json: JSON.stringify({ interactiveProps: { validation: { async } } })
      }) as Result<{ id: string; updated: string[] }>

    expect((run({ method: 'POST' }) as { ok: false; error: string }).error).toContain('url')
    expect(
      (run({ url: '/api/check', urlExpr: 'validatorUrl' }) as { ok: false; error: string }).error
    ).toContain('either url or urlExpr')
    expect(
      (run({ url: '/api/check', method: 'PUT' }) as { ok: false; error: string }).error
    ).toContain('GET or POST')
    expect((run({ urlExpr: 'validatorUrl +' }) as { ok: false; error: string }).error).toContain(
      'urlExpr'
    )
    expect(
      (run({ url: '/api/check', extra: true }) as { ok: false; error: string }).error
    ).toContain('extra')
  })

  test('rejects malformed validationSummary configs at the tool boundary (§19)', () => {
    const { figma } = setupToolTest()
    const form = figma.createRectangle()
    const run = (validationSummary: unknown) =>
      getTool('update_lowcode_node').execute(figma, {
        id: form.id,
        patch_json: JSON.stringify({ interactiveProps: { validationSummary } })
      }) as Result<{ id: string; updated: string[] }>

    expect(run(false).ok).toBe(true)
    expect((run({ enabled: 'yes' }) as { ok: false; error: string }).error).toContain('enabled')
    expect((run({ title: 123 }) as { ok: false; error: string }).error).toContain('title')
    expect((run({ enabled: true, extra: 'x' }) as { ok: false; error: string }).error).toContain(
      'extra'
    )
  })
})

describe('set_doc_states', () => {
  test('replaces the root docState array', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('set_doc_states').execute(figma, {
      states_json: JSON.stringify([
        {
          id: 'd-1',
          name: 'count',
          type: 'number',
          defaultValue: 0,
          persist: true,
          storageKey: 'demo:count',
          storageVersion: 'v1'
        },
        { id: 'd-2', name: 'items', type: 'array', defaultValue: [] }
      ])
    }) as Result<{ count: number }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.count).toBe(2)
    expect(graph.getNode(graph.rootId)?.lowcodeDocumentState?.length).toBe(2)
    expect(graph.getNode(graph.rootId)?.lowcodeDocumentState?.[0]).toMatchObject({
      persist: true,
      storageKey: 'demo:count',
      storageVersion: 'v1'
    })
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
      states_json: JSON.stringify([{ id: 'd-1', name: 'x', type: 'wizard', defaultValue: null }])
    }) as Result<{ count: number }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('wizard')
  })

  test('rejects malformed persistence metadata', () => {
    const { figma } = setupToolTest()
    const result = getTool('set_doc_states').execute(figma, {
      states_json: JSON.stringify([
        { id: 'd-1', name: 'count', type: 'number', defaultValue: 0, persist: 'yes' }
      ])
    }) as Result<{ count: number }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('persist')
  })

  test('rejects persistence metadata on page state', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id
    const result = getTool('update_lowcode_node').execute(figma, {
      id: pageId,
      patch_json: JSON.stringify({
        state: [{ id: 's-1', name: 'count', type: 'number', defaultValue: 0, persist: true }]
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('only supported on lowcodeDocumentState')
  })

  test('accepts computedExpr on page state', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id
    const result = getTool('update_lowcode_node').execute(figma, {
      id: pageId,
      patch_json: JSON.stringify({
        state: [
          { id: 's-1', name: 'count', type: 'number', defaultValue: 1 },
          {
            id: 's-2',
            name: 'doubleCount',
            type: 'number',
            defaultValue: 0,
            computedExpr: 'count * 2'
          }
        ]
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(graph.getNode(pageId)?.state?.[1]?.computedExpr).toBe('count * 2')
  })

  test('rejects computedExpr on document state', () => {
    const { figma } = setupToolTest()
    const result = getTool('set_doc_states').execute(figma, {
      states_json: JSON.stringify([
        { id: 'd-1', name: 'total', type: 'number', defaultValue: 0, computedExpr: 'count + 1' }
      ])
    }) as Result<{ count: number }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('only supported on page state')
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

describe('set_translations / read_translations (§9 v7)', () => {
  test('sets a translation catalog and reads it back', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('set_translations').execute(figma, {
      translations_json: JSON.stringify({
        fr: { Submit: 'Envoyer', 'Welcome, {name}!': 'Bienvenue, {name} !' },
        'zh-CN': { Submit: '提交' }
      })
    }) as Result<{ locales: number; entries: number }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.locales).toBe(2)
    expect(result.data?.entries).toBe(3)
    const stored = graph.getNode(graph.rootId)?.lowcodeTranslations
    expect(stored?.fr?.Submit).toBe('Envoyer')
    expect(stored?.['zh-CN']?.Submit).toBe('提交')
    const read = getTool('read_translations').execute(figma, {}) as Result<
      Record<string, Record<string, string>>
    >
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data?.fr?.['Welcome, {name}!']).toBe('Bienvenue, {name} !')
  })

  test('clears via JSON null', () => {
    const { figma, graph } = setupToolTest()
    graph.updateNode(graph.rootId, { lowcodeTranslations: { fr: { Submit: 'Envoyer' } } })
    const result = getTool('set_translations').execute(figma, {
      translations_json: 'null'
    }) as Result<{ locales: number; entries: number }>
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data?.locales).toBe(0)
    expect(graph.getNode(graph.rootId)?.lowcodeTranslations).toBeUndefined()
  })

  test('an empty object clears the field (absent ≡ no translations)', () => {
    const { figma, graph } = setupToolTest()
    graph.updateNode(graph.rootId, { lowcodeTranslations: { fr: { Submit: 'Envoyer' } } })
    const result = getTool('set_translations').execute(figma, {
      translations_json: '{}'
    }) as Result<{ locales: number; entries: number }>
    expect(result.ok).toBe(true)
    expect(graph.getNode(graph.rootId)?.lowcodeTranslations).toBeUndefined()
  })

  test('rejects a non-string translation value', () => {
    const { figma, graph } = setupToolTest()
    const result = getTool('set_translations').execute(figma, {
      translations_json: JSON.stringify({ fr: { Submit: 42 } })
    }) as Result<{ locales: number; entries: number }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('must be a string')
    expect(graph.getNode(graph.rootId)?.lowcodeTranslations).toBeUndefined()
  })

  test('rejects a locale mapping that is not an object', () => {
    const { figma } = setupToolTest()
    const result = getTool('set_translations').execute(figma, {
      translations_json: JSON.stringify({ fr: 'nope' })
    }) as Result<{ locales: number; entries: number }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('source→translated')
  })

  test('read_translations returns {} when none authored', () => {
    const { figma } = setupToolTest()
    const read = getTool('read_translations').execute(figma, {}) as Result<
      Record<string, Record<string, string>>
    >
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data).toEqual({})
  })
})

/**
 * Phase 3 §3.v2 step 1 — editor ctx undo path. With `ctx.editor` present
 * the mega tools push one `UndoEntry` per dispatch, so Cmd+Z restores
 * the whole patch in one step. Without ctx (CLI / MCP / fixture tests
 * above) the mutator falls back to `figma.graph.updateNode` with no
 * undo, preserving the headless-call semantics.
 */
describe('lowcode mutate tools — editor ctx undo (§3.v2 step 1)', () => {
  function setupEditorToolTest() {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    return { graph, figma, editor }
  }

  test('update_lowcode_node with editor pushes one undo entry that reverts the patch', () => {
    const { graph, figma, editor } = setupEditorToolTest()
    const rect = figma.createRectangle()
    const tool = getTool('update_lowcode_node')
    expect(editor.undo.canUndo).toBe(false)
    const result = tool.execute(
      figma,
      {
        id: rect.id,
        patch_json: JSON.stringify({
          interactiveProps: { text: 'Submit' },
          renderCondition: 'true'
        })
      },
      { editor }
    ) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    expect(editor.undo.canUndo).toBe(true)
    expect(editor.undo.undoLabel).toBe('AI: update_lowcode_node')
    const after = graph.getNode(rect.id) as JsonObject
    expect((after.interactiveProps as { text?: string })?.text).toBe('Submit')
    const label = editor.undo.undo()
    expect(label).toBe('AI: update_lowcode_node')
    const reverted = graph.getNode(rect.id) as JsonObject
    expect(reverted.interactiveProps).toBeUndefined()
    expect(reverted.renderCondition).toBeUndefined()
  })

  test('update_lowcode_node without editor leaves undo stack empty (fallback path)', () => {
    const { graph, figma, editor } = setupEditorToolTest()
    const rect = figma.createRectangle()
    const tool = getTool('update_lowcode_node')
    const result = tool.execute(figma, {
      id: rect.id,
      patch_json: JSON.stringify({ interactiveProps: { text: 'Submit' } })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    const after = graph.getNode(rect.id) as JsonObject
    expect((after.interactiveProps as { text?: string })?.text).toBe('Submit')
    expect(editor.undo.canUndo).toBe(false)
  })

  test('set_doc_states with editor pushes one undo entry that restores prior states', () => {
    const { graph, figma, editor } = setupEditorToolTest()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd-0', name: 'before', type: 'string', defaultValue: 'x' }]
    })
    const tool = getTool('set_doc_states')
    const result = tool.execute(
      figma,
      {
        states_json: JSON.stringify([{ id: 'd-1', name: 'after', type: 'number', defaultValue: 1 }])
      },
      { editor }
    ) as Result<{ count: number }>
    expect(result.ok).toBe(true)
    expect(editor.undo.undoLabel).toBe('AI: set_doc_states')
    editor.undo.undo()
    const restored = graph.getNode(graph.rootId)?.lowcodeDocumentState
    expect(restored).toEqual([{ id: 'd-0', name: 'before', type: 'string', defaultValue: 'x' }])
  })

  test('set_supabase_config with editor pushes one undo entry that restores prior config', () => {
    const { graph, figma, editor } = setupEditorToolTest()
    const tool = getTool('set_supabase_config')
    const r1 = tool.execute(
      figma,
      {
        config_json: JSON.stringify({
          url: 'https://x.supabase.co',
          anonKey: FAKE_ANON_JWT
        })
      },
      { editor }
    ) as Result<{ cleared: boolean }>
    expect(r1.ok).toBe(true)
    expect(graph.getNode(graph.rootId)?.lowcodeSupabaseConfig?.url).toBe('https://x.supabase.co')
    editor.undo.undo()
    expect(graph.getNode(graph.rootId)?.lowcodeSupabaseConfig).toBeUndefined()
  })

  test('update_lowcode_node accepts supabaseMutation payloadEntries (§3.v2 step 2)', () => {
    const { graph, figma, editor } = setupEditorToolTest()
    const btn = figma.createRectangle()
    const tool = getTool('update_lowcode_node')
    const result = tool.execute(
      figma,
      {
        id: btn.id,
        patch_json: JSON.stringify({
          events: {
            onClick: [
              {
                id: 'a1',
                kind: 'supabaseMutation',
                operation: 'insert',
                table: 'users',
                payloadEntries: [
                  { key: 'name', valueExpr: 'newName' },
                  { key: 'age', valueExpr: 'newAge' }
                ]
              }
            ]
          }
        })
      },
      { editor }
    ) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(true)
    const action = graph.getNode(btn.id)?.events?.onClick?.[0] as {
      kind: string
      payloadEntries?: { key: string; valueExpr: string }[]
    }
    expect(action.payloadEntries?.length).toBe(2)
    expect(action.payloadEntries?.[0].key).toBe('name')
  })

  test('update_lowcode_node rejects payloadEntries with non-identifier key (column safety)', () => {
    const { figma } = setupEditorToolTest()
    const btn = figma.createRectangle()
    const tool = getTool('update_lowcode_node')
    const result = tool.execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        events: {
          onClick: [
            {
              id: 'a1',
              kind: 'supabaseMutation',
              operation: 'insert',
              table: 'users',
              payloadEntries: [{ key: '1bad', valueExpr: '"x"' }]
            }
          ]
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('JS identifier')
  })

  test('update_lowcode_node rejects payloadEntries with duplicate keys', () => {
    const { figma } = setupEditorToolTest()
    const btn = figma.createRectangle()
    const tool = getTool('update_lowcode_node')
    const result = tool.execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        events: {
          onClick: [
            {
              id: 'a1',
              kind: 'supabaseMutation',
              operation: 'insert',
              table: 'users',
              payloadEntries: [
                { key: 'name', valueExpr: '"a"' },
                { key: 'name', valueExpr: '"b"' }
              ]
            }
          ]
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('duplicates key')
  })

  test('update_lowcode_node rejects payloadEntries with unparseable valueExpr', () => {
    const { figma } = setupEditorToolTest()
    const btn = figma.createRectangle()
    const tool = getTool('update_lowcode_node')
    const result = tool.execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        events: {
          onClick: [
            {
              id: 'a1',
              kind: 'supabaseMutation',
              operation: 'insert',
              table: 'users',
              payloadEntries: [{ key: 'name', valueExpr: 'a + ' }]
            }
          ]
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('valueExpr')
  })

  test('update_lowcode_node accepts stripeCheckout actions (§12 first knife)', () => {
    const { graph, figma, editor } = setupEditorToolTest()
    const btn = figma.createRectangle()
    const tool = getTool('update_lowcode_node')
    const result = tool.execute(
      figma,
      {
        id: btn.id,
        patch_json: JSON.stringify({
          events: {
            onClick: [
              {
                id: 'checkout-1',
                kind: 'stripeCheckout',
                endpoint: CHECKOUT_ENDPOINT,
                payloadEntries: [
                  { key: 'priceId', valueExpr: 'priceId' },
                  { key: 'quantity', valueExpr: 'qty' }
                ],
                includeAuthToken: true,
                errorTarget: 'checkoutError'
              }
            ]
          }
        })
      },
      { editor }
    ) as Result<{ id: string; updated: string[] }>

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual({
      id: 'checkout-1',
      kind: 'stripeCheckout',
      endpoint: CHECKOUT_ENDPOINT,
      payloadEntries: [
        { key: 'priceId', valueExpr: 'priceId' },
        { key: 'quantity', valueExpr: 'qty' }
      ],
      includeAuthToken: true,
      errorTarget: 'checkoutError'
    })
  })

  test('update_lowcode_node accepts stripeCustomerPortal actions (§12 portal knife)', () => {
    const { graph, figma, editor } = setupEditorToolTest()
    const btn = figma.createRectangle()
    const tool = getTool('update_lowcode_node')
    const result = tool.execute(
      figma,
      {
        id: btn.id,
        patch_json: JSON.stringify({
          events: {
            onClick: [
              {
                id: 'portal-1',
                kind: 'stripeCustomerPortal',
                endpoint: '/api/customer-portal',
                payloadEntries: [{ key: 'customerId', valueExpr: 'customerId' }],
                includeAuthToken: true,
                errorTarget: 'checkoutError'
              }
            ]
          }
        })
      },
      { editor }
    ) as Result<{ id: string; updated: string[] }>

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual({
      id: 'portal-1',
      kind: 'stripeCustomerPortal',
      endpoint: '/api/customer-portal',
      payloadEntries: [{ key: 'customerId', valueExpr: 'customerId' }],
      includeAuthToken: true,
      errorTarget: 'checkoutError'
    })
  })

  test('update_lowcode_node rejects stripeCheckout without a usable endpoint', () => {
    const { figma } = setupEditorToolTest()
    const btn = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        events: {
          onClick: [{ id: 'checkout-1', kind: 'stripeCheckout', endpoint: '' }]
        }
      })
    }) as Result<{ id: string; updated: string[] }>

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('endpoint')
  })

  test('update_lowcode_node rejects stripeCustomerPortal without a usable endpoint', () => {
    const { figma } = setupEditorToolTest()
    const btn = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        events: {
          onClick: [{ id: 'portal-1', kind: 'stripeCustomerPortal', endpoint: '' }]
        }
      })
    }) as Result<{ id: string; updated: string[] }>

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('endpoint')
  })

  test('update_lowcode_node rejects malformed stripeCheckout payload entries', () => {
    const { figma } = setupEditorToolTest()
    const btn = figma.createRectangle()
    const result = getTool('update_lowcode_node').execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        events: {
          onClick: [
            {
              id: 'checkout-1',
              kind: 'stripeCheckout',
              endpoint: '/api/checkout',
              payloadEntries: [{ key: 'bad-key', valueExpr: 'priceId +' }]
            }
          ]
        }
      })
    }) as Result<{ id: string; updated: string[] }>

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('payloadEntries')
  })

  test('runBatch (begin/commit) at dispatch layer collapses N tool pushes into 1 undo entry', () => {
    const { figma, editor } = setupEditorToolTest()
    const rect = figma.createRectangle()
    editor.undo.beginBatch('AI: update_lowcode_node')
    getTool('update_lowcode_node').execute(
      figma,
      {
        id: rect.id,
        patch_json: JSON.stringify({ interactiveProps: { text: 'a' } })
      },
      { editor }
    )
    getTool('update_lowcode_node').execute(
      figma,
      {
        id: rect.id,
        patch_json: JSON.stringify({ interactiveProps: { text: 'b' } })
      },
      { editor }
    )
    editor.undo.commitBatch()
    expect(editor.undo.canUndo).toBe(true)
    editor.undo.undo()
    expect(editor.undo.canUndo).toBe(false)
  })
})
