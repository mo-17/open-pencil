import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderCascaderModulePreview } from '#core/canvas/modules/cascader'
import { renderDateRangeModulePreview } from '#core/canvas/modules/date-range'
import { renderRatingModulePreview } from '#core/canvas/modules/rating'
import { renderSliderModulePreview } from '#core/canvas/modules/slider'
import { renderStepperModulePreview } from '#core/canvas/modules/stepper'
import { renderTreeModulePreview } from '#core/canvas/modules/tree'
import { createCascaderModuleFrameOverrides } from '#core/plugins/cascader'
import { createDateRangeModuleFrameOverrides } from '#core/plugins/date-range'
import { createRatingModuleFrameOverrides } from '#core/plugins/rating'
import { createSliderModuleFrameOverrides } from '#core/plugins/slider'
import { createStepperModuleFrameOverrides } from '#core/plugins/stepper'
import { createTreeModuleFrameOverrides } from '#core/plugins/tree'

import { carouselPixelHarness } from '../carousel/helpers'

const controls = [
  {
    name: 'Cascader',
    create: createCascaderModuleFrameOverrides,
    render: renderCascaderModulePreview
  },
  { name: 'Slider', create: createSliderModuleFrameOverrides, render: renderSliderModulePreview },
  { name: 'Rating', create: createRatingModuleFrameOverrides, render: renderRatingModulePreview },
  {
    name: 'DateRange',
    create: createDateRangeModuleFrameOverrides,
    render: renderDateRangeModulePreview
  },
  { name: 'Tree', create: createTreeModuleFrameOverrides, render: renderTreeModulePreview },
  {
    name: 'TreeSelect',
    create: () => createTreeModuleFrameOverrides({ presentation: 'select' }),
    render: renderTreeModulePreview
  },
  { name: 'Stepper', create: createStepperModuleFrameOverrides, render: renderStepperModulePreview }
] as const

for (const control of controls) {
  test(`${control.name} Canvas reflects outer disabled without changing authored values`, async () => {
    const h = await carouselPixelHarness(),
      graph = new SceneGraph(),
      node = graph.createNode('FRAME', graph.getPages()[0].id, control.create())
    const paint = () => {
      h.canvas.clear(h.ck.WHITE)
      expect(control.render(h.renderer, h.canvas, node, graph)).toBe(true)
      return h.pixels()
    }
    try {
      const enabled = paint()
      graph.updateNode(node.id, { interactiveProps: { ...node.interactiveProps, disabled: true } })
      const authored = JSON.stringify([...graph.getAllNodes()]),
        disabled = paint()
      expect(disabled.some((channel, index) => channel !== enabled[index])).toBe(true)
      expect(JSON.stringify([...graph.getAllNodes()])).toBe(authored)
    } finally {
      h.dispose()
    }
  })
}

test('readOnly Canvas values stay readable and Rating hides the unavailable clear action', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph(),
    page = graph.getPages()[0]
  const texts: string[] = [],
    build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((node, color, options) => {
    texts.push(node.text)
    return build(node, color, options)
  })
  try {
    for (const control of controls.filter((item) =>
      ['Cascader', 'Slider', 'Tree', 'TreeSelect', 'Stepper'].includes(item.name)
    )) {
      const node = graph.createNode('FRAME', page.id, control.create())
      h.canvas.clear(h.ck.WHITE)
      control.render(h.renderer, h.canvas, node, graph)
      const enabled = h.pixels()
      graph.updateNode(node.id, { interactiveProps: { ...node.interactiveProps, readOnly: true } })
      h.canvas.clear(h.ck.WHITE)
      control.render(h.renderer, h.canvas, node, graph)
      expect(h.pixels().some((channel, index) => channel !== enabled[index])).toBe(false)
    }
    const rating = graph.createNode(
      'FRAME',
      page.id,
      createRatingModuleFrameOverrides({ clearLabel: 'Clear authored score' })
    )
    texts.length = 0
    renderRatingModulePreview(h.renderer, h.canvas, rating, graph)
    expect(texts).toContain('Clear authored score')
    graph.updateNode(rating.id, {
      interactiveProps: { ...rating.interactiveProps, readOnly: true }
    })
    texts.length = 0
    renderRatingModulePreview(h.renderer, h.canvas, rating, graph)
    expect(texts).not.toContain('Clear authored score')
    expect(texts).toContain('3 / 5')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test('Tree disabled fades selected checkboxes and preserves the selected authored default', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createTreeModuleFrameOverrides({
      selectionMode: 'multiple',
      searchable: false,
      items: [{ id: 'one', label: 'One', parentId: '', disabled: false }],
      initialSelectedIds: ['one'],
      initialExpandedIds: []
    })
  )
  const paint = () => {
    h.canvas.clear(h.ck.WHITE)
    renderTreeModulePreview(h.renderer, h.canvas, node, graph)
    return h.pixels()
  }
  try {
    const enabled = paint()
    const selected = h.rgb(enabled, 40, 60)
    expect(selected).toEqual([37, 99, 235])
    graph.updateNode(node.id, { interactiveProps: { ...node.interactiveProps, disabled: true } })
    const disabled = h.rgb(paint(), 40, 60)
    expect(disabled[0]).toBeGreaterThan(selected[0])
    expect(disabled[1]).toBeGreaterThan(selected[1])
  } finally {
    h.dispose()
  }
})
