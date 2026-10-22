import { readFile } from 'node:fs/promises'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test('WebKit retains a saved Shader fixture through immediate save, reopen and PNG export without WebGPU', async ({
  page
}) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
  })
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const document = await page.evaluateHandle(
    async () => import('/tests/helpers/shaders/document.ts')
  )
  // This is a known saved PNG, not a claim that WebKit generated a WebGPU frame.
  const before = await document.evaluate((probe) => probe.createShaderDocument(true))
  await document.evaluate((probe) => probe.editShaderDocument(8, 140))
  await expect(page.locator('[data-property="shader-status"]')).toHaveAttribute(
    'data-phase',
    'saved'
  )
  page.once('dialog', (dialog) => dialog.accept('webkit-shader.fig'))
  const saved = page.waitForEvent('download')
  await page.keyboard.press('Meta+s')
  const path = await (await saved).path()
  if (!path) throw new Error('WebKit FIG download missing')
  const reopened = await document.evaluate(
    (probe, bytes) => probe.reopenShaderDocument(bytes),
    [...(await readFile(path))]
  )
  expect(reopened).toMatchObject({
    width: 140,
    children: 6,
    digest: before.digest,
    preset: { components: [{ type: 'Pixelate', props: { scale: 8 } }] }
  })
  const exported = page.waitForEvent('download')
  await page.getByTestId('export-button').click()
  const imagePath = await (await exported).path()
  if (!imagePath) throw new Error('WebKit PNG download missing')
  const image = await document.evaluate(
    (probe, bytes) => probe.imageObservation(bytes),
    [...(await readFile(imagePath))]
  )
  expect(image).toMatchObject({ width: 140, height: 96 })
  expect(image.colored).toBeGreaterThan(500)
  await expect(page.locator('[data-property="shader-status"]')).toHaveAttribute(
    'data-phase',
    'saved'
  )
  await document.dispose()
})
