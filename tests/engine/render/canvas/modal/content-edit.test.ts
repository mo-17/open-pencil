import { beforeAll, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { createSceneGeometry } from '@open-pencil/core/geometry'
import { createModalModuleFrameOverrides } from '@open-pencil/core/plugins'
import type { Color, Fill } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import { SkiaRenderer } from '#core/canvas'
import { renderFromEditorState } from '#core/canvas/renderer/pipeline'

import { expectDefined } from '#tests/helpers/assert'

let ck: Awaited<ReturnType<typeof initCanvasKit>>
beforeAll(async () => {
  ck = await initCanvasKit()
})

function solid(color: Color): Fill[] {
  return [{ type: 'SOLID', color, visible: true, opacity: 1 }]
}

test.each([0, 31])(
  'isolated content paints world-space pixels and invalidates ordinary page caches at rotation %s',
  (rotation) => {
    const editor = createEditor({ getViewportSize: () => ({ width: 800, height: 600 }) })
    const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(800, 600), 'surface'))
    try {
      const host = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        ...createModalModuleFrameOverrides({ contentChildName: 'Body' }),
        x: 440,
        y: 2778,
        width: 200,
        height: 52,
        rotation,
        flipX: rotation !== 0
      })
      const root = editor.graph.createNode('FRAME', host.id, {
        name: 'Body',
        x: 12,
        y: 24,
        width: 400,
        height: 300,
        fills: solid({ r: 1, g: 1, b: 1, a: 1 })
      })
      const green = editor.graph.createNode('RECTANGLE', root.id, {
        x: 40,
        y: 50,
        width: 80,
        height: 70,
        fills: solid({ r: 0, g: 1, b: 0, a: 1 })
      })
      const world = createSceneGeometry(editor.graph).toWorld(green, { x: 40, y: 35 })
      editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
        x: world.x - 30,
        y: world.y - 30,
        width: 60,
        height: 60,
        fills: solid({ r: 1, g: 0, b: 0, a: 1 })
      })
      expect(editor.enterContentEdit(root.id)).toBe(true)
      const view = { panX: editor.state.panX, panY: editor.state.panY, zoom: editor.state.zoom }
      editor.exitContentEdit()
      Object.assign(editor.state, view)
      const screen = {
        x: Math.floor(world.x * view.zoom + view.panX),
        y: Math.floor(world.y * view.zoom + view.panY)
      }
      function paint() {
        renderFromEditorState(renderer, editor.state, editor.graph, null, 800, 600, false)
        const snapshot = renderer.surface.makeImageSnapshot()
        try {
          return Array.from(
            expectDefined(
              snapshot.readPixels(screen.x, screen.y, {
                width: 1,
                height: 1,
                colorType: ck.ColorType.RGBA_8888,
                alphaType: ck.AlphaType.Unpremul,
                colorSpace: ck.ColorSpace.SRGB
              }),
              'sample pixel'
            )
          )
        } finally {
          snapshot.delete()
        }
      }
      expect(paint()).toEqual([255, 0, 0, 255])
      expect(renderer.scenePicture).not.toBeNull()
      editor.enterContentEdit(root.id)
      expect(paint()).toEqual([0, 255, 0, 255])
      expect(renderer.scenePicture).toBeNull()
      expect(renderer._culledCount).toBe(0)
      editor.exitContentEdit()
      expect(paint()).toEqual([255, 0, 0, 255])
    } finally {
      renderer.destroy()
      editor.dispose()
    }
  }
)
