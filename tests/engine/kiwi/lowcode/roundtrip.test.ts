import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'

import {
  exportFigFile,
  initCodec,
  parseFigFile,
  SceneGraph,
  type SceneNode
} from '@open-pencil/core'

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

  test('all 6 lowcode NodeTypes (BUTTON/INPUT/CHECKBOX/FORM/LIST/SELECT) survive round-trip', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const types = ['BUTTON', 'INPUT', 'CHECKBOX', 'FORM', 'LIST', 'SELECT'] as const
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

  test('graph without lowcode fields → reimported nodes have all four fields undefined', async () => {
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
    expect(reimportedRect.state).toBeUndefined()
    expect(reimportedRect.bindings).toBeUndefined()

    // pluginData stays clean of any `lowcode/*` entries when nothing was set.
    // Other entries (e.g. textDirection on TEXT, layoutDirection on FRAME)
    // may exist as part of normal serialization — only filter for ours.
    const ourLowcodeEntries = reimportedRect.pluginData.filter(
      (e) => e.pluginId === 'open-pencil' && e.key.startsWith('lowcode/')
    )
    expect(ourLowcodeEntries).toEqual([])
  })
})
