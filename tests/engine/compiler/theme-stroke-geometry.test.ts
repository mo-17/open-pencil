import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { Stroke } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { createRect, firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function addThemeVariables() {
  const graph = makeSceneGraph()
  graph.addCollection({
    id: 'col-theme',
    name: 'Brand Theme',
    modes: [
      { modeId: 'light', name: 'Light' },
      { modeId: 'dark', name: 'Dark' }
    ],
    defaultModeId: 'light',
    variableIds: ['var-primary']
  })
  graph.addVariable({
    id: 'var-primary',
    name: 'color/primary',
    type: 'COLOR',
    collectionId: 'col-theme',
    valuesByMode: {
      light: { r: 0.2, g: 0.4, b: 0.8, a: 1 } satisfies Color,
      dark: { r: 0.8, g: 0.9, b: 1, a: 1 } satisfies Color
    },
    description: '',
    hiddenFromPublishing: false
  })
  return graph
}

function solidStroke(
  color: Color,
  opacity = 1,
  options: Partial<Pick<Stroke, 'weight' | 'align'>> = {}
): Stroke {
  return {
    color,
    opacity,
    visible: true,
    weight: options.weight ?? 2,
    align: options.align ?? 'INSIDE'
  }
}

describe('Phase 5 §5 design token stroke geometry fallback', () => {
  test('multi-stroke token emit documents stroke align shadow placement', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)
    const rect = createRect(graph, pageId, { name: 'Token Align Stack' })
    rect.strokes = [
      solidStroke({ r: 1, g: 0, b: 0, a: 1 }, 1, { align: 'INSIDE', weight: 1 }),
      solidStroke({ r: 0, g: 1, b: 0, a: 1 }, 1, { align: 'CENTER', weight: 2 }),
      solidStroke({ r: 0, g: 0, b: 1, a: 1 }, 1, { align: 'OUTSIDE', weight: 3 })
    ]
    graph.bindVariable(rect.id, 'strokes/1/color', 'var-primary')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'theme-demo' })
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain(
      'boxShadow: "inset 0 0 0 1px #FF0000, inset 0 0 0 3px var(--op-brand-theme-color-primary), 0 0 0 3px #0000FF"'
    )
  })

  test('multi-stroke token emit warns and falls back for independent side stroke weights', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)
    const rect = createRect(graph, pageId, { name: 'Token Independent Stroke' })
    rect.strokes = [
      solidStroke({ r: 1, g: 0, b: 0, a: 1 }, 1, { weight: 1 }),
      solidStroke({ r: 0.2, g: 0.4, b: 0.8, a: 1 }, 1, { weight: 3 })
    ]
    rect.independentStrokeWeights = true
    rect.borderTopWeight = 1
    rect.borderRightWeight = 4
    rect.borderBottomWeight = 2
    rect.borderLeftWeight = 3
    graph.bindVariable(rect.id, 'strokes/1/color', 'var-primary')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'theme-demo' })
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain('style={{ borderColor: "var(--op-brand-theme-color-primary)" }}')
    expect(appTsx).not.toContain('boxShadow')
    const warning = out.warnings.find(
      (item) => item.code === 'design-token-stroke-geometry-unsupported'
    )
    expect(warning?.nodeId).toBe(rect.id)
    expect(warning?.message).toContain('independent stroke weights')
  })

  test('multi-stroke token emit warns and falls back for dash pattern strokes', () => {
    const graph = addThemeVariables()
    const pageId = firstPageId(graph)
    const rect = createRect(graph, pageId, { name: 'Token Dashed Stroke' })
    rect.strokes = [
      solidStroke({ r: 1, g: 0, b: 0, a: 1 }, 1, { weight: 1 }),
      solidStroke({ r: 0.2, g: 0.4, b: 0.8, a: 1 }, 1, { weight: 3 })
    ]
    rect.dashPattern = [4, 2]
    graph.bindVariable(rect.id, 'strokes/1/color', 'var-primary')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'theme-demo' })
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain('style={{ borderColor: "var(--op-brand-theme-color-primary)" }}')
    expect(appTsx).not.toContain('boxShadow')
    const warning = out.warnings.find(
      (item) => item.code === 'design-token-stroke-geometry-unsupported'
    )
    expect(warning?.nodeId).toBe(rect.id)
    expect(warning?.message).toContain('dash pattern')
  })
})
