import { toUint8Array } from 'js-base64'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test.use({
  launchOptions: {
    args: ['--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--use-angle=swiftshader']
  }
})

for (const animated of [false, true]) {
  test(`real WebGPU self input ${animated ? 'animates' : 'refreshes'} without changing saved frames`, async ({
    page
  }, info) => {
    test.setTimeout(60_000)
    await page.goto('/?test&no-chrome&no-rulers')
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    const capable = await page.evaluate(async () => {
      const gpu: GPU | undefined = Reflect.get(navigator, 'gpu')
      return gpu ? Boolean(await gpu.requestAdapter()) : false
    })
    test.skip(!capable, 'No WebGPU adapter; real rendering unavailable')
    const probe = await page.evaluateHandle(async (animated) => {
      const doc = await import('/tests/helpers/shaders/document.ts')
      await doc.createShaderDocument()
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('Editor missing')
      const node = [...store.graph.nodes.values()].find((node) => node.name === 'Shader acceptance')
      if (!node) throw new Error('Shader layer missing')
      if (animated)
        store.setShaderPaint([node.id], 'fills', 0, {
          components: [{ type: 'WaveDistortion', props: { strength: 0.3, frequency: 2, speed: 1 } }]
        })
      await store.settleShaderFrames({ nodeIds: [node.id], requireFrames: true })
      store.clearSelection()
      const { observeContentPlayback } =
        await import('/packages/vue/tests/canvas/surface/shader/live-observation.ts')
      return observeContentPlayback(store, node.id, () =>
        store.renderExportImage([node.id], 1, 'PNG')
      )
    }, animated)
    try {
      await probe.evaluate((p) => p.play())
      await expect.poll(() => probe.evaluate((p) => p.stats.frames)).toBeGreaterThan(3)
      expect(await probe.evaluate((p) => p.unchanged())).toBe(true)
      if (animated) {
        await expect.poll(() => probe.evaluate((p) => p.stats.distinct)).toBeGreaterThan(1)
      } else {
        await canvas.waitForRender()
        expect(await canvas.screenshotCanvasRegion(320, 260)).toMatchSnapshot(
          'shader-live-self.png',
          { maxDiffPixelRatio: 0.001 }
        )
        await probe.evaluate((p) => p.green())
        await expect.poll(() => probe.evaluate((p) => p.stats.green)).toBeGreaterThan(300)
        await canvas.waitForRender()
        expect(await canvas.screenshotCanvasRegion(320, 260)).toMatchSnapshot(
          'shader-live-self-edited.png',
          { maxDiffPixelRatio: 0.001 }
        )
        await probe.evaluate((p) => p.resize())
        await expect
          .poll(() => probe.evaluate((p) => p.stats.width / p.stats.height))
          .toBeCloseTo(2, 1)
        const exported = await probe.evaluate((p) => p.exportFrame())
        expect(exported.colored).toBeGreaterThan(100)
        expect(exported.green).toBe(0)
      }
      expect(await probe.evaluate((p) => p.unchanged())).toBe(true)
      const png = await probe.evaluate((p) => p.stats.png)
      await info.attach('actual-live-input-frame', {
        body: Buffer.from(toUint8Array(png.split(',')[1] ?? '')),
        contentType: 'image/png'
      })
      await probe.evaluate((p) => p.pause())
      await expect.poll(() => probe.evaluate((p) => p.stats.restored)).toBeGreaterThan(0)
    } finally {
      await probe.evaluate((p) => p.close())
      await probe.dispose()
    }
  })
}
