import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test.use({
  launchOptions: {
    args: ['--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--use-angle=swiftshader']
  }
})

test('real WebGPU content filters switch, edit, reset and undo through inspector controls', async ({
  page
}) => {
  test.setTimeout(60_000)
  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const capable = await page.evaluate(async () => {
    const gpu: GPU | undefined = Reflect.get(navigator, 'gpu')
    return gpu ? Boolean(await gpu.requestAdapter()) : false
  })
  test.skip(!capable, 'No WebGPU adapter; real filter rendering unavailable')
  const probe = await page.evaluateHandle(async () => import('/tests/helpers/shaders/document.ts'))
  const initial = await probe.evaluate((probe) => probe.createShaderDocument())
  const status = page.locator('[data-property="shader-status"]')
  await expect(status).toHaveAttribute('data-phase', 'ready')
  const select = page.getByRole('combobox', { name: 'Content filter', exact: true })
  for (const filter of ['Twirl', 'Saturation'] as const) {
    await select.click()
    await page.getByRole('option', { name: filter, exact: true }).click()
    const rendered = await probe.evaluate((probe) => probe.settleShaderDocument())
    expect(rendered.preset.components[0]?.type).toBe(filter)
    expect(rendered.digest).not.toBe(initial.digest)
    await expect(status).toHaveAttribute('data-phase', 'ready')
    await probe.evaluate((probe) => probe.selectShaderDocument(false))
    await canvas.waitForRender()
    expect(await canvas.screenshotCanvasRegion(300, 230)).toMatchSnapshot(
      `shader-${filter.toLowerCase()}.png`,
      { maxDiffPixelRatio: 0.001 }
    )
    await probe.evaluate((probe) => probe.selectShaderDocument(true))
  }
  const parameter = page.locator('[data-property="shader-content-parameter"] input')
  await page.locator('[data-property="shader-content-parameter"]').click()
  await parameter.fill('2')
  await parameter.press('Enter')
  const changed = await probe.evaluate((probe) => probe.settleShaderDocument())
  expect(changed.preset.components[0]?.props?.intensity).toBe(2)
  await page.getByRole('button', { name: 'Reset filter', exact: true }).click()
  expect(
    (await probe.evaluate((probe) => probe.settleShaderDocument())).preset.components[0]?.props
      ?.intensity
  ).toBe(0)
  await page.keyboard.press('Meta+z')
  expect(
    (await probe.evaluate((probe) => probe.settleShaderDocument())).preset.components[0]?.props
      ?.intensity
  ).toBe(2)
  await page.keyboard.press('Meta+Shift+z')
  expect(
    (await probe.evaluate((probe) => probe.settleShaderDocument())).preset.components[0]?.props
      ?.intensity
  ).toBe(0)
  await probe.dispose()
})

test('simulated static failure exposes saved fallback and retries only on request', async ({
  page
}) => {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const document = await page.evaluateHandle(
    async () => import('/tests/helpers/shaders/document.ts')
  )
  const before = await document.evaluate((probe) => probe.createShaderDocument(true))
  const status = page.locator('[data-property="shader-status"]')
  await expect(status).toHaveAttribute('data-phase', 'saved')
  const frame = await document.evaluateHandle((probe) => probe.shaderFrameProbe())
  try {
    const parameter = page.locator('[data-property="shader-content-parameter"] input')
    await page.locator('[data-property="shader-content-parameter"]').click()
    await parameter.fill('12')
    await parameter.press('Enter')
    await expect(status).toHaveAttribute('data-phase', 'rendering')
    await frame.evaluate((probe) => probe.finish(false))
    await expect(status).toHaveAttribute('data-phase', 'saved')
    await frame.evaluate((probe) => probe.settle())
    expect(await frame.evaluate((probe) => probe.stats.calls)).toBe(1)
    expect((await document.evaluate((probe) => probe.shaderDocumentObservation())).digest).toBe(
      before.digest
    )
    await page.getByRole('button', { name: 'Retry frame', exact: true }).click()
    await expect(status).toHaveAttribute('data-phase', 'rendering')
    await frame.evaluate((probe) => probe.finish(true))
    await expect(status).toHaveAttribute('data-phase', 'ready')
    expect(await frame.evaluate((probe) => probe.stats.calls)).toBe(2)
  } finally {
    await frame.evaluate((probe) => probe.close())
    await frame.dispose()
    await document.dispose()
  }
})
