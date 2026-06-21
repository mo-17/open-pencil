import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import {
  exportFigFile,
  initCodec,
  parseFigFile,
  SceneGraph,
  type SceneNode
} from '@open-pencil/core'
import type { ActionDef } from '@open-pencil/core/scene-graph'

setDefaultTimeout(30_000)

/**
 * Phase 1 §12 success criteria #1 + #3: state / bindings / events /
 * interactiveProps survive a real `.fig` export → parse round-trip; .fig
 * files without lowcode fields load with the four fields undefined.
 *
 * Node IDs are not preserved across a `.fig` round-trip — they're stamped
 * from `0:N` GUIDs assigned during parse. Locating reimported nodes by the
 * original id only works by coincidence. We look them up by type/name
 * instead, which is robust.
 */
describe('lowcode-roundtrip — .fig export → parse preserves lowcode fields (Phase 1 §12)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  function findFirst(graph: SceneGraph, type: SceneNode['type']): SceneNode {
    const node = [...graph.getAllNodes()].find((n) => n.type === type)
    if (!node) throw new Error(`No ${type} node in reimported graph`)
    return node
  }

  function findByName(graph: SceneGraph, name: string): SceneNode {
    const node = [...graph.getAllNodes()].find((n) => n.name === name)
    if (!node) throw new Error(`No node named "${name}" in reimported graph`)
    return node
  }

  test('page-scoped state round-trips through .fig', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const state = [
      { id: 's-count', name: 'count', type: 'number' as const, defaultValue: 0 },
      { id: 's-on', name: 'on', type: 'boolean' as const, defaultValue: false }
    ]
    graph.updateNode(page.id, { state })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedPage = reimported.getPages()[0]

    expect(reimportedPage.state).toEqual(state)
  })

  test('Phase 4 §16.1: page-level lowcodeRoutePattern round-trips through .fig', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { lowcodeRoutePattern: '/product/:id' })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedPage = reimported.getPages()[0]

    expect(reimportedPage.lowcodeRoutePattern).toBe('/product/:id')
  })

  test('Phase 4 §16.3: page requiresAuth + root authRedirect round-trip through .fig', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { lowcodeRequiresAuth: true })
    graph.updateNode(graph.rootId, { lowcodeAuthRedirect: '/signin' })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)

    expect(reimported.getPages()[0].lowcodeRequiresAuth).toBe(true)
    expect(reimported.getNode(reimported.rootId)?.lowcodeAuthRedirect).toBe('/signin')
  })

  test('BUTTON with events + interactiveProps round-trips through .fig (including NodeType)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's-count', name: 'count', type: 'number', defaultValue: 0 }]
    })
    graph.createNode('BUTTON', page.id, {
      width: 120,
      height: 40,
      interactiveProps: { text: 'Click me' },
      events: {
        onClick: [
          { id: 'a1', kind: 'setState', targetStateId: 's-count', valueExpr: 'count + 1' }
        ]
      }
    })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedBtn = findFirst(reimported, 'BUTTON')

    // Type override (decision §12.3 #7): without lowcode/nodeType the kiwi
    // codec would have demoted this to RECTANGLE.
    expect(reimportedBtn.type).toBe('BUTTON')
    expect(reimportedBtn.interactiveProps).toEqual({ text: 'Click me' })
    expect(reimportedBtn.events).toEqual({
      onClick: [
        { id: 'a1', kind: 'setState', targetStateId: 's-count', valueExpr: 'count + 1' }
      ]
    })
  })

  test('Phase 3 §10 workflow: nested condition / delay / stop survive round-trip', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    // events serialize as one JSON blob (lowcode/events), so the nested
    // then/else ActionDef chains of a `condition` round-trip with no codec
    // change — this pins that the deep structure is preserved.
    const onClick: ActionDef[] = [
      { id: 'q1', kind: 'navigate', to: '/start' },
      {
        id: 'c1',
        kind: 'condition',
        condExpr: 'count > 3',
        consequent: [{ id: 't1', kind: 'stop' }],
        alternate: [
          { id: 'e1', kind: 'delay', ms: 250 },
          { id: 'e2', kind: 'navigate', to: '/end' }
        ]
      }
    ]
    graph.updateNode(page.id, {
      state: [{ id: 's-count', name: 'count', type: 'number', defaultValue: 0 }]
    })
    graph.createNode('BUTTON', page.id, { name: 'wf-btn', events: { onClick } })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const btn = findByName(reimported, 'wf-btn')
    expect(btn.events).toEqual({ onClick })
  })

  test('Phase 4 §16.2 navigate route params survive round-trip (events JSON blob, zero codec change)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's-pid', name: 'pid', type: 'string', defaultValue: '' }]
    })
    const onClick: ActionDef[] = [
      { id: 'n1', kind: 'navigate', to: '/product/:id', params: { id: 'pid' } }
    ]
    graph.createNode('BUTTON', page.id, { name: 'nav-btn', events: { onClick } })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const btn = findByName(reimported, 'nav-btn')
    expect(btn.events).toEqual({ onClick })
  })

  test('Phase 3 §10 v2 toast (message + variant, incl nested in condition) survives round-trip', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const onClick: ActionDef[] = [
      { id: 'to1', kind: 'toast', messageExpr: '"Saved"', variant: 'success' },
      {
        id: 'c1',
        kind: 'condition',
        condExpr: 'count > 0',
        consequent: [{ id: 'to2', kind: 'toast', messageExpr: '"Has items"', variant: 'info' }]
      }
    ]
    graph.updateNode(page.id, {
      state: [{ id: 's-count', name: 'count', type: 'number', defaultValue: 0 }]
    })
    graph.createNode('BUTTON', page.id, { name: 'toast-btn', events: { onClick } })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const btn = findByName(reimported, 'toast-btn')
    expect(btn.events).toEqual({ onClick })
  })

  test('Phase 3 §10 v3 confirm (nested then/else) + clipboard survive round-trip', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const onClick: ActionDef[] = [
      {
        id: 'cf1',
        kind: 'confirm',
        messageExpr: '"Delete?"',
        consequent: [{ id: 'cb1', kind: 'clipboard', valueExpr: '"copied"' }],
        alternate: [{ id: 'to1', kind: 'toast', messageExpr: '"Cancelled"', variant: 'info' }]
      }
    ]
    graph.createNode('BUTTON', page.id, { name: 'confirm-btn', events: { onClick } })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const btn = findByName(reimported, 'confirm-btn')
    expect(btn.events).toEqual({ onClick })
  })

  test('Phase 3 §10 v5 toast position/duration + confirm labels survive round-trip', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const onClick: ActionDef[] = [
      {
        id: 'to1',
        kind: 'toast',
        messageExpr: '"Saved"',
        variant: 'success',
        position: 'top-center',
        durationMs: 5000
      },
      {
        id: 'cf1',
        kind: 'confirm',
        messageExpr: '"Delete?"',
        consequent: [{ id: 's1', kind: 'stop' }],
        confirmLabel: 'Delete',
        cancelLabel: 'Keep'
      }
    ]
    graph.createNode('BUTTON', page.id, { name: 'cfg-btn', events: { onClick } })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const btn = findByName(reimported, 'cfg-btn')
    expect(btn.events).toEqual({ onClick })
  })

  test('all 10 lowcode NodeTypes survive round-trip (Phase 2 §8 adds 4)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    // BUTTON/INPUT/CHECKBOX/FORM/LIST/SELECT (Phase 0) + RADIO/TEXTAREA/
    // DATEPICKER/SWITCH (Phase 2 §8) — all ride the lowcode/nodeType
    // pluginData channel; without it the kiwi codec demotes them to RECTANGLE.
    const types = [
      'BUTTON',
      'INPUT',
      'CHECKBOX',
      'FORM',
      'LIST',
      'SELECT',
      'RADIO',
      'TEXTAREA',
      'DATEPICKER',
      'SWITCH'
    ] as const
    for (const type of types) {
      graph.createNode(type, page.id, { name: `${type}-node` })
    }

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedTypes = [...reimported.getAllNodes()]
      .filter((n) => (types as readonly string[]).includes(n.type))
      .map((n) => n.type)
      .sort()
    expect(reimportedTypes).toEqual([...types].sort())
  })

  test('RADIO default interactiveProps (options/value/groupName) round-trip (Phase 2 §8)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('RADIO', page.id, {
      name: 'Radio-node',
      interactiveProps: { options: ['a', 'b'], value: 'b', groupName: 'choice' }
    })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const radio = findFirst(reimported, 'RADIO')

    expect(radio.type).toBe('RADIO')
    expect(radio.interactiveProps).toEqual({ options: ['a', 'b'], value: 'b', groupName: 'choice' })
  })

  test('LIST supabaseQuery dataSourceRef round-trips through .fig (Phase 4 §17)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const dataSourceRef = {
      kind: 'supabaseQuery',
      query: {
        table: 'products',
        columns: 'id,name,price',
        filters: [{ column: 'category', op: 'eq', valueExpr: 'category' }],
        orderBy: [{ column: 'price', ascending: true }],
        limit: 20
      }
    }
    graph.createNode('LIST', page.id, { name: 'Products', interactiveProps: { dataSourceRef } })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const list = findFirst(reimported, 'LIST')

    expect(list.interactiveProps).toEqual({ dataSourceRef })
  })

  test('TEXT with bindings.text → ref(stateId) round-trips through .fig', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's-count', name: 'count', type: 'number', defaultValue: 0 }]
    })
    graph.createNode('TEXT', page.id, {
      text: '0',
      bindings: { text: { kind: 'ref', stateId: 's-count' } }
    })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedText = findFirst(reimported, 'TEXT')

    expect(reimportedText.bindings).toEqual({ text: { kind: 'ref', stateId: 's-count' } })
  })

  test('graph without lowcode fields → reimported nodes have all five fields undefined', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('RECTANGLE', page.id, {
      name: 'Plain rect',
      width: 80,
      height: 60
    })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedPage = reimported.getPages()[0]
    const reimportedRect = findFirst(reimported, 'RECTANGLE')

    expect(reimportedPage.state).toBeUndefined()
    expect(reimportedPage.bindings).toBeUndefined()
    expect(reimportedPage.events).toBeUndefined()
    expect(reimportedPage.interactiveProps).toBeUndefined()
    expect(reimportedPage.renderCondition).toBeUndefined()
    expect(reimportedPage.lowcodeRoutePattern).toBeUndefined()
    expect(reimportedRect.state).toBeUndefined()
    expect(reimportedRect.bindings).toBeUndefined()
    expect(reimportedRect.renderCondition).toBeUndefined()

    // pluginData stays clean of any `lowcode/*` entries when nothing was set.
    // Other entries (e.g. textDirection on TEXT, layoutDirection on FRAME)
    // may exist as part of normal serialization — only filter for ours.
    const ourLowcodeEntries = reimportedRect.pluginData.filter(
      (e) => e.pluginId === 'open-pencil' && e.key.startsWith('lowcode/')
    )
    expect(ourLowcodeEntries).toEqual([])
  })

  test('renderCondition expression round-trips through .fig (Phase 2 §9)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's-flag', name: 'flag', type: 'boolean', defaultValue: false }]
    })
    graph.createNode('FRAME', page.id, {
      name: 'Conditional frame',
      width: 200,
      height: 80,
      renderCondition: 'flag'
    })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    // findFirst('FRAME') would return the document root (also typed FRAME);
    // look up by the unique node name instead.
    const reimportedFrame = findByName(reimported, 'Conditional frame')

    expect(reimportedFrame.renderCondition).toBe('flag')
  })

  test('bindings.text with kind=expr round-trips through .fig (Phase 2 §9)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('TEXT', page.id, {
      text: 'placeholder',
      bindings: { text: { kind: 'expr', expr: 'item.name' } }
    })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedText = findFirst(reimported, 'TEXT')

    expect(reimportedText.bindings).toEqual({
      text: { kind: 'expr', expr: 'item.name' }
    })
  })

  test('document-level lowcodeDocumentState round-trips on the root node (Phase 2 §2)', async () => {
    const graph = new SceneGraph()
    const docState = [
      { id: 'd-username', name: 'username', type: 'string' as const, defaultValue: 'guest' },
      { id: 'd-cart', name: 'cartCount', type: 'number' as const, defaultValue: 0 },
      { id: 'd-on', name: 'isLoggedIn', type: 'boolean' as const, defaultValue: false }
    ]
    graph.updateNode(graph.rootId, { lowcodeDocumentState: docState })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedRoot = reimported.getNode(reimported.rootId)

    expect(reimportedRoot?.lowcodeDocumentState).toEqual(docState)
  })

  test('bindings.text with kind=docState round-trips through .fig (Phase 2 §2)', async () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd-cart', name: 'cartCount', type: 'number', defaultValue: 0 }
      ]
    })
    const page = graph.getPages()[0]
    graph.createNode('TEXT', page.id, {
      text: '0',
      bindings: { text: { kind: 'docState', docStateName: 'cartCount' } }
    })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedText = findFirst(reimported, 'TEXT')

    expect(reimportedText.bindings).toEqual({
      text: { kind: 'docState', docStateName: 'cartCount' }
    })
  })

  test('graph without lowcodeDocumentState → reimported root has the field undefined (byte regression)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('RECTANGLE', page.id, { name: 'Plain rect', width: 80, height: 60 })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedRoot = reimported.getNode(reimported.rootId)

    expect(reimportedRoot?.lowcodeDocumentState).toBeUndefined()
  })

  test('FRAME with layoutMode FREE round-trips through .fig (Phase 2 §6)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, {
      name: 'FreeCard',
      width: 300,
      height: 200,
      layoutMode: 'FREE'
    })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedFrame = findByName(reimported, 'FreeCard')

    expect(reimportedFrame.layoutMode).toBe('FREE')
  })

  test('FRAME without FREE → reimported FRAME keeps the original layoutMode (byte regression)', async () => {
    // Pre-§6 .fig files have no `lowcode/freeLayout` entry, so a FRAME with
    // a non-FREE layoutMode (NONE / HORIZONTAL / VERTICAL / GRID) must
    // round-trip unchanged — `freeLayoutOverride` stays undefined and the
    // kiwi-restored mode wins.
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, {
      name: 'FlexRow',
      width: 400,
      height: 80,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 16,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    graph.createNode('FRAME', page.id, {
      name: 'PlainBox',
      width: 100,
      height: 100,
      layoutMode: 'NONE'
    })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)

    expect(findByName(reimported, 'FlexRow').layoutMode).toBe('HORIZONTAL')
    expect(findByName(reimported, 'PlainBox').layoutMode).toBe('NONE')
  })

  test('root lowcodeSupabaseConfig round-trips through .fig (Phase 3 §2)', async () => {
    const graph = new SceneGraph()
    const config = {
      url: 'https://abc.supabase.co',
      anonKey: 'eyJhbGc.anonpayload.sig',
      schema: 'public'
    }
    graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: config })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedRoot = reimported.getNode(reimported.rootId)

    expect(reimportedRoot?.lowcodeSupabaseConfig).toEqual(config)
  })

  test('root lowcodeSupabaseConfig round-trips without optional schema field', async () => {
    const graph = new SceneGraph()
    const config = { url: 'https://x.supabase.co', anonKey: 'anon' }
    graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: config })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedRoot = reimported.getNode(reimported.rootId)

    expect(reimportedRoot?.lowcodeSupabaseConfig).toEqual(config)
  })

  test('graph without supabaseConfig → reimported root has the field undefined (byte regression)', async () => {
    // Pre-Phase-3 §2 .fig files have no `lowcode/supabaseConfig` entry, so a
    // graph without Supabase wiring must round-trip unchanged — the field
    // stays undefined and the compiler skips the `_lowcode_supabase.ts` emit.
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('RECTANGLE', page.id, { name: 'Plain rect', width: 80, height: 60 })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedRoot = reimported.getNode(reimported.rootId)

    expect(reimportedRoot?.lowcodeSupabaseConfig).toBeUndefined()
  })

  test('FRAME responsiveOverrides round-trip through .fig (Phase 3 §7)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'ResponsiveStack',
      width: 400,
      height: 200,
      layoutMode: 'VERTICAL',
      itemSpacing: 8
    })
    const overrides = {
      md: { layoutMode: 'HORIZONTAL' as const, itemSpacing: 24 },
      lg: { counterAxisAlign: 'CENTER' as const, visible: false }
    }
    graph.updateNode(frame.id, { responsiveOverrides: overrides })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedFrame = findByName(reimported, 'ResponsiveStack')

    expect(reimportedFrame.responsiveOverrides).toEqual(overrides)
  })

  test('graph without responsiveOverrides → reimported node has the field undefined (byte regression)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, {
      name: 'PlainStack',
      width: 400,
      height: 200,
      layoutMode: 'VERTICAL'
    })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)

    expect(findByName(reimported, 'PlainStack').responsiveOverrides).toBeUndefined()
  })

  test('FRAME stateOverrides round-trip through .fig (Phase 4 §20)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'StatefulCard',
      width: 200,
      height: 80,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    const overrides = {
      hover: { fills: [{ type: 'SOLID' as const, color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }] },
      disabled: { opacity: 0.5 }
    }
    graph.updateNode(frame.id, { stateOverrides: overrides })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)

    expect(findByName(reimported, 'StatefulCard').stateOverrides).toEqual(overrides)
  })

  test('graph without stateOverrides → reimported node has the field undefined (byte regression)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, { name: 'PlainCard', width: 200, height: 80 })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)

    expect(findByName(reimported, 'PlainCard').stateOverrides).toBeUndefined()
  })

  test('root lowcodeTranslations catalog round-trips through .fig (Phase 3 §9 v7)', async () => {
    const graph = new SceneGraph()
    const translations = {
      fr: { Submit: 'Envoyer', 'Welcome, {name}!': 'Bienvenue, {name} !' },
      'zh-CN': { Submit: '提交' }
    }
    graph.updateNode(graph.rootId, { lowcodeTranslations: translations })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedRoot = reimported.getNode(reimported.rootId)

    expect(reimportedRoot?.lowcodeTranslations).toEqual(translations)
  })

  test('graph without lowcodeTranslations → reimported root has the field undefined (byte regression)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('RECTANGLE', page.id, { name: 'Plain', width: 80, height: 60 })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)

    expect(reimported.getNode(reimported.rootId)?.lowcodeTranslations).toBeUndefined()
  })

  test('root lowcodeWorkflows round-trips through .fig (Phase 3 §10 v4)', async () => {
    const graph = new SceneGraph()
    const workflows = [
      {
        id: 'wf-save',
        name: 'Save & toast',
        actions: [
          { id: 'a1', kind: 'toast' as const, messageExpr: '"Saved"', variant: 'success' as const },
          {
            id: 'a2',
            kind: 'condition' as const,
            condExpr: 'count > 0',
            consequent: [{ id: 'a3', kind: 'callWorkflow' as const, workflowId: 'wf-other' }]
          }
        ]
      },
      { id: 'wf-other', name: 'Other', actions: [{ id: 'b1', kind: 'navigate' as const, to: '/x' }] }
    ]
    graph.updateNode(graph.rootId, { lowcodeWorkflows: workflows })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const reimportedRoot = reimported.getNode(reimported.rootId)

    expect(reimportedRoot?.lowcodeWorkflows).toEqual(workflows)
  })

  test('graph without lowcodeWorkflows → reimported root has the field undefined (byte regression)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('RECTANGLE', page.id, { name: 'Plain', width: 80, height: 60 })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)

    expect(reimported.getNode(reimported.rootId)?.lowcodeWorkflows).toBeUndefined()
  })

  test('workflow params + callWorkflow args round-trip through .fig (Phase 3 §10 v6)', async () => {
    const graph = new SceneGraph()
    const workflows = [
      {
        id: 'notify',
        name: 'Notify',
        params: ['msg', 'level'],
        actions: [{ id: 't', kind: 'toast' as const, messageExpr: 'msg' }]
      }
    ]
    graph.updateNode(graph.rootId, { lowcodeWorkflows: workflows })
    const page = graph.getPages()[0]
    const onClick: ActionDef[] = [
      { id: 'cw', kind: 'callWorkflow', workflowId: 'notify', args: { msg: '"hi"', level: '1' } }
    ]
    graph.createNode('BUTTON', page.id, { name: 'arg-btn', events: { onClick } })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)

    expect(reimported.getNode(reimported.rootId)?.lowcodeWorkflows).toEqual(workflows)
    const btn = [...reimported.getAllNodes()].find((n) => n.name === 'arg-btn')
    expect(btn?.events).toEqual({ onClick })
  })

  test('instance overrides round-trip through .fig (Phase 3 §8 v11)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const comp = graph.createNode('COMPONENT', page.id, {
      name: 'Card',
      width: 100,
      height: 30,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', comp.id, { name: 'Label', text: 'orig', width: 80, height: 20 })
    const inst = graph.createInstance(comp.id, page.id)
    if (!inst) throw new Error('instance failed')
    const child = graph.getChildren(inst.id)[0]
    graph.updateNode(child.id, { text: 'OVERRIDDEN' })
    inst.overrides = { [`${child.id}:text`]: 'OVERRIDDEN' }

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)

    const inst2 = [...reimported.getAllNodes()].find((n) => n.type === 'INSTANCE')
    expect(inst2).toBeDefined()
    const child2 = inst2 ? reimported.getChildren(inst2.id)[0] : undefined
    // the diverged child value survives (was reverting to the master default)
    expect(child2?.text).toBe('OVERRIDDEN')
    // the override marker survives, remapped to the reimported child's id
    expect(Object.keys(inst2?.overrides ?? {})).toEqual([`${child2?.id}:text`])
    // and the pending snapshot was consumed
    expect(inst2?.pendingInstanceOverrides).toBeUndefined()
  })

  test('a clean instance has no overrides after .fig round-trip (byte regression)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const comp = graph.createNode('COMPONENT', page.id, {
      name: 'Card',
      width: 100,
      height: 30,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', comp.id, { name: 'Label', text: 'orig', width: 80, height: 20 })
    graph.createInstance(comp.id, page.id) // clean

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    const inst2 = [...reimported.getAllNodes()].find((n) => n.type === 'INSTANCE')
    expect(Object.keys(inst2?.overrides ?? {})).toEqual([])
    expect(inst2?.pendingInstanceOverrides).toBeUndefined()
  })

  test('a deep override (node inside a nested instance) round-trips (§8 v9 + v11)', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const inner = graph.createNode('COMPONENT', page.id, {
      name: 'Card',
      width: 100,
      height: 30,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', inner.id, { name: 'Label', text: 'orig', width: 80, height: 20 })
    const outer = graph.createNode('COMPONENT', page.id, {
      name: 'Panel',
      width: 120,
      height: 50,
      layoutMode: 'VERTICAL'
    })
    graph.createInstance(inner.id, outer.id) // nested clean instance
    const deep = graph.createInstance(outer.id, page.id)
    if (!deep) throw new Error('instance failed')
    // find the deep Label clone inside the nested instance
    const stack = [...graph.getChildren(deep.id)]
    let deepLabel: SceneNode | undefined
    while (stack.length > 0) {
      const n = stack.pop()
      if (!n) continue
      if (n.type === 'TEXT') {
        deepLabel = n
        break
      }
      stack.push(...graph.getChildren(n.id))
    }
    if (!deepLabel) throw new Error('no deep label')
    graph.updateNode(deepLabel.id, { text: 'DEEP' })
    deep.overrides = { [`${deepLabel.id}:text`]: 'DEEP' }

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)
    // the deep child value survives across the nested-instance re-clone
    const deepTexts = [...reimported.getAllNodes()].filter(
      (n) => n.type === 'TEXT' && n.text === 'DEEP'
    )
    expect(deepTexts.length).toBe(1)
  })

  test('workflow paramDefaults + optionalParams round-trip through .fig (Phase 3 §10 v7/v8)', async () => {
    const graph = new SceneGraph()
    const workflows = [
      {
        id: 'notify',
        name: 'Notify',
        params: ['msg', 'detail'],
        paramDefaults: { msg: '"Done"' },
        optionalParams: ['detail'],
        actions: [{ id: 't', kind: 'toast' as const, messageExpr: 'msg' }]
      }
    ]
    graph.updateNode(graph.rootId, { lowcodeWorkflows: workflows })

    const bytes = await exportFigFile(graph)
    const reimported = await parseFigFile(bytes.buffer)

    expect(reimported.getNode(reimported.rootId)?.lowcodeWorkflows).toEqual(workflows)
  })
})
