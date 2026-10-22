import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { shaderIslandPixels } from '#tests/helpers/shaders/playback-island'

test.use({
  launchOptions: {
    args: ['--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--use-angle=swiftshader']
  }
})

test('real own-content animation in a DOM island preserves fallback and input focus', async ({
  page
}) => {
  test.setTimeout(60_000)
  await page.goto('/?test&no-chrome&no-rulers')
  await new CanvasHelper(page).waitForInit()
  const capable = await page.evaluate(async () => {
    const gpu: GPU | undefined = Reflect.get(navigator, 'gpu')
    return gpu ? Boolean(await gpu.requestAdapter()) : false
  })
  test.skip(!capable, 'No WebGPU adapter; real rendering unavailable')
  const fixture = await page.evaluate(async () => {
    const { createShaderPlaybackIsland } = await import('/tests/helpers/shaders/playback-island.ts')
    return createShaderPlaybackIsland()
  })
  try {
    const island = page.locator(`[data-island="${fixture.root}"]`)
    const input = island.getByRole('textbox')
    await expect(input).toHaveValue('Name')
    await expect
      .poll(async () => (await page.evaluate(shaderIslandPixels)).colored)
      .toBeGreaterThan(100)
    const first = (await page.evaluate(shaderIslandPixels)).png
    await expect.poll(async () => (await page.evaluate(shaderIslandPixels)).png).not.toBe(first)
    await input.fill('Live input')
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('Live input')
    await page.evaluate(({ decoration }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('Editor missing')
      for (const child of store.graph.getChildren(decoration))
        store.graph.updateNode(child.id, {
          fills: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 }, visible: true, opacity: 1 }]
        })
    }, fixture)
    await expect
      .poll(async () => (await page.evaluate(shaderIslandPixels)).green)
      .toBeGreaterThan(100)
    await expect(input).toBeFocused()
    expect(
      await page.evaluate(
        ({ image }) => [...(window.openPencil?.getStore?.()?.graph.images.get(image) ?? [])],
        fixture
      )
    ).toEqual(fixture.saved)
    const image = island.locator('img')
    await expect(image).toHaveAttribute('src', /^data:image\//)
    await expect(island.locator('canvas')).toHaveCSS('pointer-events', 'none')
  } finally {
    await page.evaluate(() => window.openPencil?.getStore?.()?.stopPlay())
  }
})
