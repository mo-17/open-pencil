import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, type LowcodePageViewportMode, type SceneNode } from '@open-pencil/scene-graph'

export function viewportFixture(mode?: LowcodePageViewportMode) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    name: 'Adaptive preview',
    ...(mode ? { lowcodePageViewport: { version: 1, mode } } : {}),
    state: [{ id: 'counter-state', name: 'count', type: 'number', defaultValue: 0 }],
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
  })
  const frame = graph.createNode('FRAME', page.id, {
    name: 'Screen',
    x: -60,
    y: -90,
    width: 360,
    height: 740,
    layoutMode: 'NONE',
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
    responsiveOverrides:
      mode === 'responsive'
        ? {
            compact: {
              layoutMode: 'VERTICAL',
              layoutPositioning: 'AUTO',
              primaryAxisSizing: 'HUG',
              counterAxisSizing: 'FILL',
              paddingLeft: 24,
              paddingRight: 24,
              paddingTop: 24,
              paddingBottom: 24,
              itemSpacing: 16
            },
            xl: {
              layoutMode: 'VERTICAL',
              primaryAxisSizing: 'HUG',
              counterAxisSizing: 'FILL',
              itemSpacing: 24
            }
          }
        : undefined
  })
  const text = (parentId: string, overrides: Partial<SceneNode>) =>
    graph.createNode('TEXT', parentId, {
      width: 312,
      height: 32,
      fontSize: 18,
      text: 'Adaptive preview',
      primaryAxisSizing: mode === 'responsive' ? 'HUG' : 'FIXED',
      counterAxisSizing: mode === 'responsive' ? 'FILL' : 'FIXED',
      ...overrides
    })
  const title = text(frame.id, { x: 24, y: 24, text: 'Mobile preview' })
  const counter = text(frame.id, {
    x: 24,
    y: 72,
    bindings: { text: { kind: 'expr', expr: '"Count: " + count' } }
  })
  const button = graph.createNode('BUTTON', frame.id, {
    name: 'Increment',
    x: 24,
    y: 130,
    width: 312,
    height: 48,
    interactiveProps: { text: 'Increment +1', ariaLabel: 'Increment counter' },
    primaryAxisSizing: mode === 'responsive' ? 'HUG' : 'FIXED',
    counterAxisSizing: mode === 'responsive' ? 'FILL' : 'FIXED',
    ...(mode === 'responsive' ? { minHeight: 48 } : {}),
    events: {
      onClick: [
        {
          id: 'increment-action',
          kind: 'setState',
          targetStateId: 'counter-state',
          valueExpr: 'count + 1'
        }
      ]
    }
  })
  const row = graph.createNode('FRAME', frame.id, {
    name: 'Fill row',
    x: 24,
    y: 208,
    width: 312,
    height: 48,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: mode === 'responsive' ? 'FILL' : 'FIXED',
    itemSpacing: 12,
    counterAxisAlign: 'STRETCH'
  })
  const left = text(row.id, {
    text: 'Left',
    width: 150,
    height: 48,
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: mode === 'responsive' ? 'FILL' : 'FIXED'
  })
  const right = text(row.id, {
    text: 'Right',
    width: 150,
    height: 48,
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: mode === 'responsive' ? 'FILL' : 'FIXED'
  })
  const detail = text(frame.id, {
    text: 'A longer paragraph wraps to the available width and respects the system text size. It remains in the document flow.',
    x: 24,
    y: 300,
    height: 170
  })
  const footer = text(frame.id, { text: 'Bottom of page', x: 24, y: 690 })
  return { graph, page, frame, title, counter, button, row, left, right, detail, footer }
}

export function compileViewportFixture(fixture: ReturnType<typeof viewportFixture>) {
  return compile({
    graph: fixture.graph,
    pageIds: [fixture.page.id],
    options: withDefaults({
      target: 'flutter',
      router: 'none',
      devMode: true,
      packageName: 'mobile_adaptation_acceptance',
      productName: 'Mobile adaptation acceptance'
    })
  })
}

export function generatedFlutterPage(files: ReadonlyMap<string, string | Uint8Array>): string {
  const page = [...files].find(
    ([path]) => path.startsWith('lib/pages/') && path.endsWith('.dart')
  )?.[1]
  if (typeof page !== 'string') throw new Error('Missing generated Flutter page')
  return page
}
