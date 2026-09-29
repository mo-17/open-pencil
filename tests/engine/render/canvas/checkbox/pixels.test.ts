import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { recordRenderChunk, RenderChunkIndex } from '#core/canvas/renderer/chunks'
import { missingGlyphCharacters } from '#core/text/resolver'

import { expectDefined } from '#tests/helpers/assert'

import { carouselPixelHarness } from '../carousel/helpers'

test('CHECKBOX real pixels show selected Chinese groups, survive chunk recording and clip small frames', async () => {
  const h = await carouselPixelHarness()
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [{ id: 'plans', name: 'plans', type: 'array', defaultValue: ['团队'] }]
  })
  const node = graph.createNode('CHECKBOX', page.id, {
    x: 20,
    y: 20,
    width: 240,
    height: 88,
    fontSize: 16,
    interactiveProps: { options: ['个人 Personal', '团队'] },
    bindings: { value: { kind: 'ref', stateId: 'plans' } }
  })
  const shaped: Array<{ text: string; missing: string[] }> = []
  const original = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    const paragraph = original(label, color, options)
    shaped.push({
      text: label.text,
      missing: missingGlyphCharacters(label.text, paragraph.getShapedLines())
    })
    return paragraph
  })
  const paint = () => {
    h.canvas.clear(h.ck.WHITE)
    h.renderer.renderNode(h.canvas, graph, node.id, {})
    return h.pixels()
  }
  try {
    const before = structuredClone(node)
    const direct = paint()
    expect(shaped).toContainEqual({ text: '个人 Personal', missing: [] })
    expect(shaped).toContainEqual({ text: '团队', missing: [] })
    expect(h.rgb(direct, 23, 60)).toEqual([37, 99, 235])
    expect(h.rgb(direct, 23, 28)).toEqual([255, 255, 255])
    await h.save('checkbox-group')
    const { index } = RenderChunkIndex.build(graph, page.id)
    try {
      expect(index.getChunksDependingOnNode(page.id).map((chunk) => chunk.nodeId)).toContain(
        node.id
      )
      const recorded = recordRenderChunk(
        h.renderer,
        graph,
        expectDefined(index.getChunksForNode(node.id)[0], 'checkbox chunk')
      )
      try {
        h.canvas.clear(h.ck.WHITE)
        h.canvas.drawPicture(recorded.picture)
        expect(h.pixels()).toEqual(direct)
      } finally {
        recorded.picture.delete()
      }
    } finally {
      index.dispose()
    }
    expect(node).toEqual(before)
    graph.updateNode(node.id, { width: 12, height: 10, strokes: [], layoutMode: 'HORIZONTAL' })
    h.renderer.invalidateNodePicture(node.id)
    const small = paint()
    for (const [x, y] of [
      [19, 25],
      [32, 25],
      [25, 19],
      [25, 30]
    ])
      expect(h.rgb(small, x, y)).toEqual([255, 255, 255])
    await h.save('checkbox-small')
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})

test.each([false, true])(
  'CHECKBOX bound default expires cached effect content (raster=%s)',
  async (raster) => {
    const h = await carouselPixelHarness()
    const graph = new SceneGraph()
    const node = graph.createNode('CHECKBOX', graph.getPages()[0].id, {
      width: 20,
      height: 20,
      bindings: { value: { kind: 'docState', docStateName: 'enabled' } },
      effects: [
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.2 },
          offset: { x: 1, y: 1 },
          radius: 2,
          spread: 0,
          visible: true
        }
      ]
    })
    const set = (defaultValue: boolean) =>
      graph.updateNode(graph.rootId, {
        lowcodeDocumentState: [{ id: 'enabled', name: 'enabled', type: 'boolean', defaultValue }]
      })
    const paint = () => {
      h.canvas.clear(h.ck.WHITE)
      h.renderer.renderShape(h.canvas, node, graph)
      return h.pixels()
    }
    h.renderer.renderingSceneBacking = raster
    try {
      set(true)
      const on = paint()
      expect(h.rgb(on, 3, 3)).toEqual([37, 99, 235])
      expect(
        raster
          ? h.renderer.effectRasterCache.has(node.id)
          : h.renderer.nodePictureCache.has(node.id)
      ).toBe(true)
      set(false)
      h.renderer.invalidateNodePicture(graph.rootId)
      expect(h.rgb(paint(), 3, 3)).toEqual([255, 255, 255])
    } finally {
      h.dispose()
    }
  }
)
