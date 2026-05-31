import { beforeAll, describe, expect, test } from 'bun:test'

import {
  computeAllLayouts,
  exportFigFile,
  initCodec,
  parseFigFile,
  SceneGraph
} from '@open-pencil/core'

import { expectDefined } from '#tests/helpers/assert'

// Round-trip regression for layout fields that previously changed the canvas
// after save→reopen while the lowcode preview (compiler reads surviving
// absolute geometry) stayed unchanged. Each was a serialize/deserialize
// asymmetry in the .fig kiwi codec. See fig-layout-roundtrip-findings.md.

beforeAll(async () => {
  await initCodec()
})

function pageId(graph: SceneGraph) {
  return graph.getPages()[0].id
}

async function roundtrip(graph: SceneGraph) {
  const exported = await exportFigFile(graph)
  return parseFigFile(exported.buffer as ArrayBuffer)
}

function findByName(re: Awaited<ReturnType<typeof roundtrip>>, name: string) {
  return expectDefined(
    [...re.nodes.values()].find((n) => n.name === name),
    `${name} after roundtrip`
  )
}

describe('.fig layout round-trip', () => {
  test('C2: strokesIncludedInLayout survives (was reset to false — read wrong field)', async () => {
    const graph = new SceneGraph()
    graph.createNode('FRAME', pageId(graph), {
      name: 'BorderFrame',
      width: 300,
      height: 200,
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      strokesIncludedInLayout: true,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    expect(findByName(await roundtrip(graph), 'BorderFrame').strokesIncludedInLayout).toBe(true)
  })

  test('C4: counterAxisAlignContent SPACE_BETWEEN survives (was reset to AUTO)', async () => {
    const graph = new SceneGraph()
    graph.createNode('FRAME', pageId(graph), {
      name: 'WrapFrame',
      width: 200,
      height: 300,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 8,
      layoutWrap: 'WRAP',
      counterAxisAlignContent: 'SPACE_BETWEEN'
    })
    const n = findByName(await roundtrip(graph), 'WrapFrame')
    expect(n.layoutWrap).toBe('WRAP')
    expect(n.counterAxisAlignContent).toBe('SPACE_BETWEEN')
  })

  test('C1: FILL axis sizing survives (was collapsed to FIXED)', async () => {
    const graph = new SceneGraph()
    graph.createNode('FRAME', pageId(graph), {
      name: 'FillFrame',
      width: 300,
      height: 200,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FILL',
      counterAxisSizing: 'FILL'
    })
    const n = findByName(await roundtrip(graph), 'FillFrame')
    expect(n.primaryAxisSizing).toBe('FILL')
    expect(n.counterAxisSizing).toBe('FILL')
  })

  test('C1: HUG/FIXED still round-trip correctly (no FILL pluginData emitted)', async () => {
    const graph = new SceneGraph()
    graph.createNode('FRAME', pageId(graph), {
      name: 'HugFrame',
      width: 300,
      height: 200,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FIXED'
    })
    const n = findByName(await roundtrip(graph), 'HugFrame')
    expect(n.primaryAxisSizing).toBe('HUG')
    expect(n.counterAxisSizing).toBe('FIXED')
  })

  test('C5: nested auto-layout HUG child with fill keeps its Yoga position (was pinned to 0,0)', async () => {
    const graph = new SceneGraph()
    const parent = graph.createNode('FRAME', pageId(graph), {
      name: 'ParentAL',
      width: 400,
      height: 300,
      layoutMode: 'VERTICAL',
      itemSpacing: 10,
      paddingTop: 20,
      paddingLeft: 20,
      paddingBottom: 20,
      paddingRight: 20,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    graph.createNode('FRAME', parent.id, {
      name: 'NestedHug',
      width: 100,
      height: 50,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    const re = await roundtrip(graph)
    // The bug surfaces on the editor's post-load re-layout, not raw import.
    computeAllLayouts(re)
    const child = findByName(re, 'NestedHug')
    // padding 20 → first child lands at (20, 20), not the origin
    expect(child.x).toBe(20)
    expect(child.y).toBe(20)
    // figmaDerivedLayout still preserves the HUG-derived size, just not x/y
    expect(child.figmaDerivedLayout?.x).toBeUndefined()
  })
})
