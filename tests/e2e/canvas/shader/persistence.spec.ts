import { readFile } from 'node:fs/promises'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test.use({
  launchOptions: {
    args: ['--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--use-angle=swiftshader']
  }
})

test('real WebGPU edits settle through download save, reopen, PNG export and GPU-free reopen', async ({
  page,
  browser
}) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  const capable = await page.evaluate(async () => {
    const gpu: GPU | undefined = Reflect.get(navigator, 'gpu')
    return gpu ? Boolean(await gpu.requestAdapter()) : false
  })
  test.skip(!capable, 'No WebGPU adapter; real rendering acceptance unavailable')
  const document = await page.evaluateHandle(
    async () => import('/tests/helpers/shaders/document.ts')
  )
  const before = await document.evaluate((probe) => probe.createShaderDocument())
  await document.evaluate((probe) => probe.editShaderDocument(8, 140))
  const saved = page.waitForEvent('download')
  page.once('dialog', (dialog) => dialog.accept('shader-acceptance.fig'))
  await page.keyboard.press('Meta+s')
  const savedPath = await (await saved).path()
  if (!savedPath) throw new Error('Shader FIG download missing')
  const bytes = [...(await readFile(savedPath))]
  const reopened = await document.evaluate((probe, data) => probe.reopenShaderDocument(data), bytes)
  expect(reopened).toMatchObject({
    width: 140,
    children: 6,
    preset: { components: [{ type: 'Pixelate', props: { scale: 8 } }] },
    frame: { width: 140, height: 96 }
  })
  expect(reopened.bytes).toBeGreaterThan(100)
  expect(reopened.digest).not.toBe(before.digest)
  await document.evaluate((probe) => probe.editShaderDocument(15, 150))
  const exported = page.waitForEvent('download')
  await page.getByTestId('export-button').click()
  const imagePath = await (await exported).path()
  if (!imagePath) throw new Error('Shader PNG download missing')
  const image = await document.evaluate(
    (probe, data) => probe.imageObservation(data),
    [...(await readFile(imagePath))]
  )
  expect(image).toMatchObject({ width: 150, height: 96 })
  expect(image.colored).toBeGreaterThan(500)
  const after = await document.evaluate((probe) => probe.shaderDocumentObservation())
  expect(after.frame).toMatchObject({ width: 150, height: 96 })
  expect(after.digest).not.toBe(reopened.digest)
  await document.dispose()

  for (const mode of ['missing', 'no-adapter'] as const) {
    const fallback = await browser.newPage()
    try {
      await fallback.addInitScript((capability) => {
        Object.defineProperty(navigator, 'gpu', {
          configurable: true,
          value: capability === 'missing' ? undefined : { requestAdapter: async () => null }
        })
      }, mode)
      await fallback.goto('/?test')
      await new CanvasHelper(fallback).waitForInit()
      const result = await fallback.evaluate(async (data) => {
        const probe = await import('/tests/helpers/shaders/document.ts')
        const before = await probe.reopenShaderDocument(data)
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('Fallback editor missing')
        await store.settleShaderFrames({
          nodeIds: [store.state.currentPageId],
          requireFrames: true
        })
        return { before, after: await probe.shaderDocumentObservation() }
      }, bytes)
      expect(result.before).toEqual(reopened)
      expect(result.after).toEqual(reopened)
    } finally {
      await fallback.close()
    }
  }
})
