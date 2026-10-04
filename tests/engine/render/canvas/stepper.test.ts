import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { controlDesignDependencies } from '#core/canvas/control-state'
import { renderStepperModulePreview } from '#core/canvas/modules/stepper'
import { readModuleInitialValue } from '#core/canvas/modules/value-controls'
import {
  createStepperModuleFrameOverrides,
  resolveStepperModule,
  stepperCurrentIndex
} from '#core/plugins/stepper'

import { carouselPixelHarness } from './carousel/helpers'

test('Stepper Canvas projects scoped state defaults and invalid steps without repairing graph state', async () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [{ id: 'step', name: 'step', type: 'number', defaultValue: 0 }]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'doc', name: 'doc', type: 'number', defaultValue: 2 }]
  })
  const node = graph.createNode('FRAME', page.id, {
    ...createStepperModuleFrameOverrides(),
    bindings: { currentIndex: { kind: 'ref', stateId: 'step' } }
  })
  const resolved = resolveStepperModule(node.interactiveProps?.module)
  if (!resolved?.ok) throw new Error('Stepper unavailable')
  const h = await carouselPixelHarness()
  const paint = () => {
    h.canvas.clear(h.ck.WHITE)
    expect(renderStepperModulePreview(h.renderer, h.canvas, node, graph)).toBe(true)
    return h.pixels()
  }
  try {
    const before = JSON.stringify([...graph.getAllNodes()])
    let pixels = paint()
    // Configured index is 1, while the declared page value is 0.
    expect(h.rgb(pixels, 22, 32)).toEqual([37, 99, 235])
    expect(h.rgb(pixels, 189, 32)).toEqual([255, 255, 255])
    expect(JSON.stringify([...graph.getAllNodes()])).toBe(before)
    expect(controlDesignDependencies(graph, node)).toEqual([page.id])
    graph.updateNode(node.id, {
      bindings: { currentIndex: { kind: 'docState', docStateName: 'doc' } }
    })
    expect(readModuleInitialValue(graph, node, 'currentIndex', 'number')).toEqual({
      bound: true,
      value: 2
    })
    expect(controlDesignDependencies(graph, node)).toEqual([graph.rootId])
    pixels = paint()
    expect(h.rgb(pixels, 189, 32)).toEqual([37, 99, 235])
    for (const value of [-1, 3, 1.5, Number.NaN]) {
      graph.updateNode(graph.rootId, {
        lowcodeDocumentState: [{ id: 'doc', name: 'doc', type: 'number', defaultValue: value }]
      })
      const binding = readModuleInitialValue(graph, node, 'currentIndex', 'number')
      expect(stepperCurrentIndex(resolved.config, binding.value, binding.bound)).toBeNull()
      pixels = paint()
      expect(h.rgb(pixels, 22, 32)).toEqual([255, 255, 255])
      expect(h.rgb(pixels, 189, 32)).toEqual([255, 255, 255])
    }
    const disabled = {
      ...resolved.config,
      items: resolved.config.items.map((item, index) => ({ ...item, disabled: index === 1 }))
    }
    expect(stepperCurrentIndex(disabled, 1, true)).toBeNull()
    expect(stepperCurrentIndex(disabled, 2, true)).toBe(2)
    expect(stepperCurrentIndex(disabled, undefined, false)).toBeNull()
    for (const type of ['COMPONENT', 'COMPONENT_SET', 'INSTANCE'] as const) {
      const body = graph.createNode(type, page.id)
      graph.reparentNode(node.id, body.id)
      graph.updateNode(node.id, {
        bindings: { currentIndex: { kind: 'ref', stateId: 'step' } }
      })
      expect(readModuleInitialValue(graph, node, 'currentIndex', 'number')).toEqual({
        bound: true,
        value: undefined
      })
      graph.updateNode(graph.rootId, {
        lowcodeDocumentState: [{ id: 'doc', name: 'doc', type: 'number', defaultValue: 2 }]
      })
      graph.updateNode(node.id, {
        bindings: { currentIndex: { kind: 'docState', docStateName: 'doc' } }
      })
      expect(readModuleInitialValue(graph, node, 'currentIndex', 'number')).toEqual({
        bound: true,
        value: 2
      })
    }
  } finally {
    h.dispose()
  }
})
