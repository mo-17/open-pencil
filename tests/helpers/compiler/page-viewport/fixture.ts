import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, type LowcodePageViewportV1 } from '@open-pencil/scene-graph'

export function pageViewportGraph(mode?: LowcodePageViewportV1['mode']) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    ...(mode ? { lowcodePageViewport: { version: 1, mode } } : {}),
    state: [{ id: 'viewportCount', name: 'viewportCount', type: 'number', defaultValue: 0 }],
    fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3, a: 1 }, opacity: 1, visible: true }]
  })
  const frame = graph.createNode('FRAME', page.id, {
    name: 'Device content',
    x: -80,
    y: -40,
    width: 800,
    height: 1200,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    itemSpacing: 24,
    paddingTop: 24,
    paddingLeft: 24,
    paddingRight: 24,
    paddingBottom: 24
  })
  graph.createNode('TEXT', frame.id, {
    name: 'Counter',
    text: 'Count 0',
    width: 200,
    height: 40,
    fontSize: 24,
    bindings: { text: { kind: 'expr', expr: "'Count ' + viewportCount" } }
  })
  graph.createNode('BUTTON', frame.id, {
    name: 'Increment',
    width: 240,
    height: 64,
    interactiveProps: { text: 'Increment' },
    events: {
      onClick: [
        {
          id: 'increment-viewport',
          kind: 'setState',
          targetStateId: 'viewportCount',
          valueExpr: 'viewportCount + 1'
        }
      ]
    }
  })
  graph.createNode('RECTANGLE', frame.id, { name: 'Long content', width: 200, height: 850 })
  graph.createNode('BUTTON', frame.id, {
    name: 'Last action',
    width: 240,
    height: 64,
    interactiveProps: { text: 'Last action' },
    events: {
      onClick: [
        {
          id: 'last-viewport',
          kind: 'setState',
          targetStateId: 'viewportCount',
          valueExpr: 'viewportCount + 1'
        }
      ]
    }
  })
  return { graph, pageId: page.id, frameId: frame.id }
}

export function pageViewportFixture(
  target: 'react' | 'vue',
  mode: LowcodePageViewportV1['mode'],
  devMode = false
) {
  const { graph, pageId } = pageViewportGraph(mode)
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, devMode, packageName: 'viewport-contract' })
  })
}

export function pageViewportBandsFixture(target: 'react' | 'vue', devMode = false) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    lowcodePageViewport: { version: 1, mode: 'responsive' },
    state: [{ id: 'bandCount', name: 'bandCount', type: 'number', defaultValue: 0 }]
  })
  const free = graph.createNode('FRAME', page.id, {
    name: 'Free to flow',
    x: -40,
    y: -20,
    width: 800,
    height: 400,
    layoutMode: 'NONE',
    paddingTop: 16,
    paddingBottom: 16,
    responsiveOverrides: { compact: { layoutMode: 'VERTICAL' } }
  })
  graph.createNode('BUTTON', free.id, {
    name: 'Band counter',
    x: 16,
    y: 16,
    width: 240,
    height: 80,
    interactiveProps: { text: 'Band increment' },
    events: {
      onClick: [
        {
          id: 'band-increment',
          kind: 'setState',
          targetStateId: 'bandCount',
          valueExpr: 'bandCount + 1'
        }
      ]
    }
  })
  graph.createNode('TEXT', free.id, {
    name: 'Band count',
    text: 'Band count 0',
    width: 240,
    height: 40,
    bindings: { text: { kind: 'expr', expr: "'Band count ' + bandCount" } }
  })
  const flow = graph.createNode('FRAME', page.id, {
    name: 'Flow to free',
    x: -40,
    y: 500,
    width: 800,
    height: 600,
    layoutMode: 'VERTICAL',
    paddingTop: 16,
    paddingBottom: 16,
    responsiveOverrides: { compact: { layoutMode: 'NONE' } }
  })
  graph.createNode('TEXT', flow.id, {
    name: 'Band detail',
    x: 16,
    y: 16,
    text: 'Band detail',
    width: 240,
    height: 80
  })
  return compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, devMode, packageName: 'viewport-bands-contract' })
  })
}
