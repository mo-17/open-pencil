import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

// Exercise WebGPU through Chromium's test adapter where hardware GPU access is unavailable.
test.use({
  launchOptions: {
    args: ['--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--use-angle=swiftshader']
  }
})

for (const capability of ['missing', 'no-adapter'] as const) {
  test(`Shader fallback with WebGPU ${capability}`, async ({ page }) => {
    await page.addInitScript((mode) => {
      Object.defineProperty(navigator, 'gpu', {
        configurable: true,
        value: mode === 'missing' ? undefined : { requestAdapter: async () => null }
      })
    }, capability)
    await page.goto('/?test&no-chrome&no-rulers')
    await new CanvasHelper(page).waitForInit()
    const result = await page.evaluate(async () => {
      const { createShaderRasterizer } =
        await import('/packages/vue/src/canvas/surface/shader/rasterizer.ts')
      const rasterizer = createShaderRasterizer()
      try {
        return {
          available: rasterizer !== null,
          bytes:
            (await rasterizer?.render(
              { components: [{ type: 'Aurora' }] },
              { width: 8, height: 8 }
            )) ?? null
        }
      } finally {
        rasterizer?.destroy?.()
      }
    })
    expect(result.available).toBe(capability !== 'missing')
    expect(result.bytes).toBeNull()
  })
}

for (const failure of [
  'initialization',
  'device-loss',
  'document-switch',
  'manual-retry',
  'canvas-remount'
] as const) {
  test(`simulated Shader playback ${failure} restores static frames`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} })
    })
    await page.goto('/?test&no-chrome&no-rulers')
    await new CanvasHelper(page).waitForInit()
    const probe = await page.evaluateHandle(async (mode) => {
      const { shaderPlaybackProbe } =
        await import('/packages/vue/tests/canvas/surface/playback-probe.ts')
      return shaderPlaybackProbe(mode)
    }, failure)
    try {
      await expect.poll(() => probe.evaluate((p) => p.stats.starts)).toBe(1)
      if (failure === 'document-switch') await probe.evaluate((p) => p.switchDocument())
      await expect.poll(() => probe.evaluate((p) => p.stats.disposed)).toBeGreaterThan(0)
      const stats = await probe.evaluate((p) => ({ ...p.stats, saved: p.saved() }))
      expect(stats.saved).toEqual([42])
      expect(stats.restored).toBeGreaterThan(0)
      expect(stats.starts).toBe(1)
      if (failure !== 'device-loss') expect(stats.published).toBe(0)
      else expect(stats.published).toBe(1)
      if (failure !== 'document-switch')
        await expect.poll(() => probe.evaluate((p) => p.status()?.reason)).toBe('failed')
      if (failure === 'manual-retry') {
        await probe.evaluate((p) => p.retry())
        await expect.poll(() => probe.evaluate((p) => p.stats.starts)).toBe(2)
        await expect.poll(() => probe.evaluate((p) => p.stats.published)).toBeGreaterThan(0)
        expect(await probe.evaluate((p) => p.saved())).toEqual([42])
      }
      if (failure === 'canvas-remount') {
        await probe.evaluate((p) => p.remount())
        await expect.poll(() => probe.evaluate((p) => p.stats.starts)).toBe(2)
        await expect.poll(() => probe.evaluate((p) => p.stats.published)).toBeGreaterThan(0)
        await expect.poll(() => probe.evaluate((p) => p.status()?.phase)).toBe('ready')
        expect(await probe.evaluate((p) => p.saved())).toEqual([42])
      }
    } finally {
      await probe.evaluate((p) => p.close())
      await probe.dispose()
    }
  })
}

test('real WebGPU pixelates own content and refreshes after editing', async ({ page }) => {
  test.setTimeout(60_000)
  const diagnostics: string[] = []
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) diagnostics.push(message.text())
  })
  await page.goto('/?test&no-chrome&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  const capability = await page.evaluate(async () => {
    const gpu: GPU | undefined = Reflect.get(navigator, 'gpu')
    return gpu ? Boolean(await gpu.requestAdapter()) : false
  })
  test.skip(!capability, 'No real WebGPU adapter in this browser')
  const result = await page
    .evaluate(async () => {
      async function pixels(bytes: Uint8Array) {
        const image = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
        const target = document.createElement('canvas')
        target.width = image.width
        target.height = image.height
        const context = target.getContext('2d')
        if (!context) throw new Error('No test pixel context')
        context.drawImage(image, 0, 0)
        image.close()
        const data = context.getImageData(0, 0, target.width, target.height).data
        let blue = 0
        let text = 0
        for (let index = 0; index < data.length; index += 4) {
          if (data[index + 2] > 150 && data[index + 2] > data[index] * 2 && data[index + 3] > 0)
            blue++
          if (
            data[index] < 70 &&
            data[index + 1] < 70 &&
            data[index + 2] < 70 &&
            data[index + 3] > 0
          )
            text++
        }
        return {
          width: target.width,
          height: target.height,
          alpha: data
            .filter((_value, index) => index % 4 === 3)
            .reduce((sum, value) => sum + value, 0),
          bytes: bytes.length,
          blue,
          text
        }
      }
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('Editor missing')
      const node = store.graph.createNode('FRAME', store.state.currentPageId, {
        x: 80,
        y: 80,
        width: 160,
        height: 120,
        fills: [],
        clipsContent: true,
        rotation: 12,
        opacity: 0.8
      })
      const child = store.graph.createNode('RECTANGLE', node.id, {
        x: 12,
        y: 15,
        width: 90,
        height: 70,
        rotation: 18,
        fills: [{ type: 'SOLID', color: { r: 1, g: 0.25, b: 0, a: 1 }, visible: true, opacity: 1 }]
      })
      store.graph.createNode('TEXT', node.id, {
        x: 12,
        y: 85,
        width: 130,
        height: 25,
        text: 'Shader',
        fontSize: 18
      })
      const source = document.createElement('canvas')
      source.width = 20
      source.height = 20
      const sourceContext = source.getContext('2d')
      if (!sourceContext) throw new Error('No image source context')
      sourceContext.fillStyle = '#1273df'
      sourceContext.fillRect(0, 0, 20, 20)
      const blob = await new Promise<Blob | null>((resolve) => {
        source.toBlob(resolve)
      })
      if (!blob) throw new Error('No image source')
      const imageHash = store.storeImage(new Uint8Array(await blob.arrayBuffer()))
      store.graph.createNode('RECTANGLE', node.id, {
        x: 110,
        y: 20,
        width: 35,
        height: 35,
        fills: [
          {
            type: 'IMAGE',
            imageHash,
            imageScaleMode: 'FIT',
            color: { r: 0, g: 0, b: 0, a: 0 },
            visible: true,
            opacity: 1
          }
        ]
      })
      store.setContentShader([node.id])
      await store.settleShaderFrames({ nodeIds: [node.id], requireFrames: true })
      const image = node.fills.at(-1)?.imageHash ?? ''
      const before = store.graph.images.get(image)
      if (!before) throw new Error('No real Shader frame was rendered')
      store.graph.updateNode(child.id, { width: 45 })
      await store.settleShaderFrames({ nodeIds: [node.id], requireFrames: true })
      const after = store.graph.images.get(image)
      store.clearSelection()
      store.requestRender()
      return {
        before: await pixels(before),
        after: after && (await pixels(after)),
        changed: Boolean(after && before.some((byte, index) => byte !== after[index])),
        length: after?.length ?? 0
      }
    })
    .catch((error: unknown) => {
      throw new Error(`${String(error)}
${diagnostics.join('; ')}`)
    })
  expect(result, JSON.stringify(result)).toMatchObject({ changed: true })
  expect(result.length).toBeGreaterThan(100)
  expect(result.before.blue).toBeGreaterThan(20)
  expect(result.after?.blue).toBeGreaterThan(20)
  expect(result.after?.text).toBeGreaterThan(20)
  await canvas.waitForRender()
  expect(await canvas.screenshotCanvasRegion(320, 260)).toMatchSnapshot('shader-own-content.png', {
    maxDiffPixelRatio: 0.001
  })
})

test('rotated faded and blended subtrees retain their visual bounds', async ({ page }) => {
  await page.goto('/?test&no-chrome&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Editor missing')
    const fills = [
      { type: 'SOLID' as const, color: { r: 0.1, g: 0.6, b: 1, a: 1 }, visible: true, opacity: 1 }
    ]
    const parent = store.graph.createNode('FRAME', store.state.currentPageId, {
      x: 170,
      y: 120,
      width: 200,
      height: 150,
      rotation: 25,
      flipX: true,
      fills: [],
      clipsContent: false
    })
    const frame = store.graph.createNode('FRAME', parent.id, {
      x: 25,
      y: 15,
      width: 130,
      height: 90,
      rotation: 25,
      opacity: 0.5,
      fills: [],
      clipsContent: false
    })
    store.graph.createNode('RECTANGLE', frame.id, {
      x: 10,
      y: 5,
      width: 180,
      height: 70,
      rotation: 15,
      fills
    })
    store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      x: 450,
      y: 130,
      width: 160,
      height: 100,
      rotation: 45,
      opacity: 0.65,
      blendMode: 'MULTIPLY',
      fills
    })
    store.clearSelection()
    store.requestRender()
  })
  await canvas.waitForRender()
  canvas.assertNoErrors()
  expect(await canvas.screenshotCanvasRegion(660, 400)).toMatchSnapshot(
    'rotated-isolation-bounds.png'
  )
})
