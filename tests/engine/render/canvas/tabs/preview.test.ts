import { expect, test } from 'bun:test'

import { initCanvasKit } from '#cli/headless'
import { SkiaRenderer } from '#core/canvas/renderer'
import { hasVolatileOverlay, render } from '#core/canvas/renderer/pipeline'
import { createEditor } from '#core/editor/create'
import { createTabsModuleFrameOverrides } from '#core/plugins/tabs'
import { fontManager } from '#core/text/fonts'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

test('temporary Tabs pixels change only in the editor and restore cached authored output', async () => {
  const editor = createEditor()
  const host = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    ...createTabsModuleFrameOverrides({
      tabs: [
        { id: 'one', label: 'One', content: '', contentChildName: 'First' },
        { id: 'two', label: 'Two', content: '', contentChildName: 'Second' }
      ],
      initialTabId: 'one'
    }),
    width: 240,
    height: 180,
    strokes: []
  })
  for (const [name, color] of [
    ['First', { r: 1, g: 0, b: 0, a: 1 }],
    ['Second', { r: 0, g: 0.5, b: 1, a: 1 }]
  ] as const) {
    editor.graph.createNode('RECTANGLE', host.id, {
      name,
      x: 16,
      y: 70,
      width: 100,
      height: 80,
      fills: [{ type: 'SOLID', color, opacity: 1, visible: true }]
    })
  }
  const ck = await initCanvasKit()
  const surface = expectDefined(ck.MakeSurface(240, 180), 'Tabs preview surface')
  const renderer = new SkiaRenderer(ck, surface)
  const provider = ck.TypefaceFontProvider.Make()
  fontManager.attachProvider(ck, provider)
  fontManager.markLoaded(
    'Inter',
    'Regular',
    await Bun.file(repoPath('packages/core/assets/Inter-Regular.ttf')).arrayBuffer()
  )
  fontManager.markLoaded(
    'Inter',
    'Semi Bold',
    await Bun.file(repoPath('packages/core/assets/Inter-SemiBold.ttf')).arrayBuffer()
  )
  renderer.fontProvider = provider
  renderer.fontsLoaded = true
  renderer.pageId = editor.state.currentPageId
  renderer.viewportWidth = 240
  renderer.viewportHeight = 180
  renderer.showRulers = false
  const sample = () => {
    const image = surface.makeImageSnapshot()
    try {
      return Array.from(
        expectDefined(
          image.readPixels(30, 90, {
            width: 1,
            height: 1,
            colorType: ck.ColorType.RGBA_8888,
            alphaType: ck.AlphaType.Unpremul,
            colorSpace: ck.ColorSpace.SRGB
          }),
          'Tabs body pixel'
        )
      )
    } finally {
      image.delete()
    }
  }
  const draw = () =>
    render(renderer, editor.graph, new Set(), { tabsPreview: editor.state.tabsPreview }, 7)
  try {
    draw()
    expect(sample()).toEqual([255, 0, 0, 255])
    const authoredPicture = renderer.scenePicture
    expect(authoredPicture).not.toBeNull()
    editor.previewTabsTab(host.id, 'two')
    expect(hasVolatileOverlay({ tabsPreview: editor.state.tabsPreview })).toBe(true)
    draw()
    expect(sample()).toEqual([0, 128, 255, 255])
    expect(renderer.scenePicture).toBe(authoredPicture)
    surface.getCanvas().clear(ck.WHITE)
    renderer.renderSceneToCanvas(surface.getCanvas(), editor.graph, editor.state.currentPageId)
    expect(sample()).toEqual([255, 0, 0, 255])
    draw()
    expect(sample()).toEqual([0, 128, 255, 255])
    editor.clearTabsTabPreview()
    draw()
    expect(sample()).toEqual([255, 0, 0, 255])
    expect(hasVolatileOverlay({ tabsPreview: editor.state.tabsPreview })).toBe(false)
    expect(renderer.scenePicture).toBe(authoredPicture)
  } finally {
    renderer.destroy()
    editor.dispose()
  }
})
