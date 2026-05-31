import { beforeAll, describe, expect, test } from 'bun:test'

import {
  computeAllLayouts,
  exportFigFile,
  initCodec,
  parseFigFile,
  sceneNodeToKiwi,
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

  test('C3: GRID container tracks/gaps and child placement survive (was degraded to NONE)', async () => {
    const graph = new SceneGraph()
    const grid = graph.createNode('FRAME', pageId(graph), {
      name: 'GridFrame',
      width: 300,
      height: 200,
      layoutMode: 'GRID',
      gridTemplateColumns: [
        { sizing: 'FR', value: 1 },
        { sizing: 'FIXED', value: 80 },
        { sizing: 'AUTO', value: 0 }
      ],
      gridTemplateRows: [{ sizing: 'FR', value: 1 }],
      gridColumnGap: 12,
      gridRowGap: 8,
      paddingTop: 4,
      paddingLeft: 6,
      paddingBottom: 4,
      paddingRight: 6
    })
    graph.createNode('FRAME', grid.id, {
      name: 'PlacedCell',
      width: 80,
      height: 40,
      gridPosition: { column: 2, row: 1, columnSpan: 1, rowSpan: 1 }
    })
    const re = await roundtrip(graph)
    const n = findByName(re, 'GridFrame')
    expect(n.layoutMode).toBe('GRID')
    expect(n.gridTemplateColumns).toEqual([
      { sizing: 'FR', value: 1 },
      { sizing: 'FIXED', value: 80 },
      { sizing: 'AUTO', value: 0 }
    ])
    expect(n.gridTemplateRows).toEqual([{ sizing: 'FR', value: 1 }])
    expect(n.gridColumnGap).toBe(12)
    expect(n.gridRowGap).toBe(8)
    expect(n.paddingLeft).toBe(6)
    const cell = findByName(re, 'PlacedCell')
    expect(cell.gridPosition).toEqual({ column: 2, row: 1, columnSpan: 1, rowSpan: 1 })
  })
})

// Figma-compat SAVE: FILL must be emitted as Figma-NATIVE child fill so external
// readers (Figma, app.openpencil.dev without our `lowcode/*` pluginData) lay out
// fill correctly. Cross-axis FILL previously emitted nothing native (figma-api
// leaves layoutGrow=0 for cross fill), so a fill-width button collapsed to its
// fixed width outside our patched reader. Dual-write: native + pluginData; our
// own reader neutralizes the synthesized native fields to stay drift-free.

function childKiwi(graph: SceneGraph, parentId: string, childName: string) {
  const blobs: Uint8Array[] = []
  const changes = sceneNodeToKiwi(
    expectDefined(graph.getNode(parentId), 'parent'),
    { sessionID: 1, localID: 0 },
    0,
    { value: 100 },
    graph,
    blobs
  ) as Record<string, unknown>[]
  return expectDefined(
    changes.find((nc) => nc.name === childName),
    `${childName} node change`
  )
}

describe('.fig FILL → Figma-native child fill (write side)', () => {
  test('cross-axis FILL (fill-width row-button in column parent) → stackChildAlignSelf=STRETCH, no grow', () => {
    const graph = new SceneGraph()
    const parent = graph.createNode('FRAME', pageId(graph), {
      name: 'ColParent',
      width: 300,
      height: 400,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('FRAME', parent.id, {
      name: 'FillWidthBtn',
      width: 120,
      height: 40,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FILL',
      counterAxisSizing: 'HUG'
    })
    const nc = childKiwi(graph, parent.id, 'FillWidthBtn')
    expect(nc.stackChildAlignSelf).toBe('STRETCH')
    expect(nc.stackChildPrimaryGrow).toBeUndefined()
  })

  test('main-axis FILL (fill-width container in row parent) → stackChildPrimaryGrow=1', () => {
    const graph = new SceneGraph()
    const parent = graph.createNode('FRAME', pageId(graph), {
      name: 'RowParent',
      width: 400,
      height: 100,
      layoutMode: 'HORIZONTAL'
    })
    graph.createNode('FRAME', parent.id, {
      name: 'FillMainBtn',
      width: 120,
      height: 40,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FILL',
      counterAxisSizing: 'HUG'
    })
    const nc = childKiwi(graph, parent.id, 'FillMainBtn')
    expect(nc.stackChildPrimaryGrow).toBe(1)
    expect(nc.stackChildAlignSelf).toBeUndefined()
  })

  test('both axes FILL → grow=1 and STRETCH together', () => {
    const graph = new SceneGraph()
    const parent = graph.createNode('FRAME', pageId(graph), {
      name: 'ColParentB',
      width: 300,
      height: 400,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('FRAME', parent.id, {
      name: 'FillBoth',
      width: 120,
      height: 40,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FILL',
      counterAxisSizing: 'FILL'
    })
    const nc = childKiwi(graph, parent.id, 'FillBoth')
    expect(nc.stackChildPrimaryGrow).toBe(1)
    expect(nc.stackChildAlignSelf).toBe('STRETCH')
  })

  test('non-auto-layout parent → FILL writes no native fill (sizing has no flex meaning)', () => {
    const graph = new SceneGraph()
    const parent = graph.createNode('FRAME', pageId(graph), {
      name: 'PlainParent',
      width: 300,
      height: 400
      // layoutMode defaults to 'NONE'
    })
    graph.createNode('FRAME', parent.id, {
      name: 'FillInPlain',
      width: 120,
      height: 40,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FILL',
      counterAxisSizing: 'FILL'
    })
    const nc = childKiwi(graph, parent.id, 'FillInPlain')
    expect(nc.stackChildPrimaryGrow).toBeUndefined()
    expect(nc.stackChildAlignSelf).toBeUndefined()
  })

  test('genuine layoutAlignSelf=CENTER is not overwritten by FILL synthesis', () => {
    const graph = new SceneGraph()
    const parent = graph.createNode('FRAME', pageId(graph), {
      name: 'RowParentC',
      width: 400,
      height: 100,
      layoutMode: 'HORIZONTAL'
    })
    graph.createNode('FRAME', parent.id, {
      name: 'FillMainCenter',
      width: 120,
      height: 40,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FILL',
      counterAxisSizing: 'HUG',
      layoutAlignSelf: 'CENTER'
    })
    const nc = childKiwi(graph, parent.id, 'FillMainCenter')
    expect(nc.stackChildPrimaryGrow).toBe(1)
    expect(nc.stackChildAlignSelf).toBe('CENTER')
  })
})

describe('.fig FILL → Figma-native child fill (read symmetry)', () => {
  function fillChildGraph(
    parentMode: 'HORIZONTAL' | 'VERTICAL',
    childProps: Record<string, unknown>
  ) {
    const graph = new SceneGraph()
    const parent = graph.createNode('FRAME', pageId(graph), {
      name: 'P',
      width: 400,
      height: 400,
      layoutMode: parentMode
    })
    graph.createNode('FRAME', parent.id, { name: 'Child', width: 100, height: 40, ...childProps })
    return graph
  }

  test('cross-axis FILL round-trips: sizing=FILL restored, layoutAlignSelf NOT drifted to STRETCH', async () => {
    const graph = fillChildGraph('VERTICAL', {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FILL',
      counterAxisSizing: 'HUG'
    })
    const child = findByName(await roundtrip(graph), 'Child')
    expect(child.primaryAxisSizing).toBe('FILL')
    expect(child.layoutAlignSelf).toBe('AUTO')
    expect(child.layoutGrow).toBe(0)
  })

  test('main-axis FILL round-trips: sizing=FILL restored, layoutGrow NOT drifted to 1', async () => {
    const graph = fillChildGraph('HORIZONTAL', {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FILL',
      counterAxisSizing: 'HUG'
    })
    const child = findByName(await roundtrip(graph), 'Child')
    expect(child.primaryAxisSizing).toBe('FILL')
    expect(child.layoutGrow).toBe(0)
    expect(child.layoutAlignSelf).toBe('AUTO')
  })

  test('genuine STRETCH without any FILL (legacy/Figma import) is preserved on reopen', async () => {
    const graph = fillChildGraph('HORIZONTAL', { layoutAlignSelf: 'STRETCH' })
    const child = findByName(await roundtrip(graph), 'Child')
    expect(child.layoutAlignSelf).toBe('STRETCH')
  })

  // The editor canvas re-runs Yoga (computeAllLayouts) on load. `figmaDerivedLayout`
  // (reconstructed at import for HUG-axis containers with visible paint) used to
  // pin BOTH width and height, so a HUG-height / FILL-width button got its width
  // pinned to the authored value and never filled on the canvas — even though the
  // preview (reads primaryAxisSizing=FILL) filled correctly. Only the HUG axis
  // must be pinned; the FILL axis is left to Yoga.
  test('fill-width HUG-height button actually fills parent width after computeAllLayouts', async () => {
    const graph = new SceneGraph()
    const parent = graph.createNode('FRAME', pageId(graph), {
      name: 'Card',
      width: 320,
      height: 200,
      layoutMode: 'VERTICAL',
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const btn = graph.createNode('FRAME', parent.id, {
      name: 'FillBtn',
      width: 120,
      height: 44,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FILL',
      counterAxisSizing: 'HUG',
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    graph.createNode('TEXT', btn.id, { name: 'BtnLabel', width: 60, height: 20, text: 'Go' })

    const re = await roundtrip(graph)
    computeAllLayouts(re)
    const child = findByName(re, 'FillBtn')
    // Card is 320 wide with 16px side padding → fill-width content is 288, not 120
    expect(child.width).toBe(288)
    // HUG height still pinned via the derived layout (anti-collapse); width is not
    expect(child.figmaDerivedLayout?.width).toBeUndefined()
    expect(child.figmaDerivedLayout?.height).toBe(44)
  })
})
