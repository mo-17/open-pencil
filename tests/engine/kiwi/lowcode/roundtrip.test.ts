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
})
