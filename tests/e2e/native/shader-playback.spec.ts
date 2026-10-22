import { strict as assert } from 'node:assert'

import {
  createShaderPlaybackIsland,
  shaderIslandPixels
} from '#tests/helpers/shaders/playback-island'
import { openNativeEditorDocument } from '#tests/helpers/tauri/editor-ready'

describe('native own-content Shader playback', () => {
  it('animates actual island pixels, refreshes source and preserves the saved fallback', async function () {
    await openNativeEditorDocument()
    const capable = await browser.execute(async () => {
      const gpu: { requestAdapter(): Promise<unknown | null> } | undefined = Reflect.get(
        navigator,
        'gpu'
      )
      return gpu ? Boolean(await gpu.requestAdapter()) : false
    })
    if (!capable) return this.skip()
    const fixture = await browser.execute(createShaderPlaybackIsland)
    try {
      await browser.waitUntil(async () => (await browser.execute(shaderIslandPixels)).colored > 100)
      const first = (await browser.execute(shaderIslandPixels)).png
      await browser.waitUntil(async () => (await browser.execute(shaderIslandPixels)).png !== first)
      await browser.execute(({ decoration }) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('Native editor missing')
        for (const child of store.graph.getChildren(decoration))
          store.graph.updateNode(child.id, {
            fills: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 }, visible: true, opacity: 1 }]
          })
      }, fixture)
      await browser.waitUntil(async () => (await browser.execute(shaderIslandPixels)).green > 100)
      const saved = await browser.execute(
        ({ image }) => [...(window.openPencil?.getStore?.()?.graph.images.get(image) ?? [])],
        fixture
      )
      assert.deepEqual(saved, fixture.saved)
    } finally {
      await browser.execute(() => window.openPencil?.getStore?.()?.stopPlay())
    }
  })
})
