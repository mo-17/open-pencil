import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { installTourResourceProbe, serveTourExport } from '#tests/helpers/compiler/vr-tour'

const exportRoot = process.env.OPENPENCIL_VR_HYBRID_EXPORT_ROOT

for (const target of ['expo', 'flutter', 'taro'] as const) {
  test(`${target} prepared hybrid HTML displays saved residential images without a network image request`, async ({
    page
  }, testInfo) => {
    test.skip(!exportRoot, 'Prepare the hybrid exports with OPENPENCIL_VR_HYBRID_EXPORT_ROOT first')
    if (!exportRoot) return
    test.setTimeout(60000)
    const server = await serveTourExport(join(exportRoot, target))
    const requests: string[] = []
    const errors: string[] = []
    page.on('request', (request) => {
      if (request.resourceType() !== 'document') requests.push(request.url())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      if (target === 'flutter')
        await page.addInitScript(() => {
          Reflect.deleteProperty(globalThis, 'createImageBitmap')
        })
      await page.goto(server.url)
      const probe = await installTourResourceProbe(page)
      const load = page.getByRole('button', { name: '加载全景', exact: true })
      await expect(load).toBeVisible()
      await expect(page.locator('.psv-canvas')).toHaveCount(0)
      await load.click()
      await expect(page.getByRole('status')).toContainText('拖动查看四周')
      const canvas = page.locator('.psv-canvas')
      await expect(canvas).toBeVisible()
      await expect(page.locator('.psv-canvas-container')).toHaveCSS('opacity', '1')
      const before = await canvas.screenshot()
      const box = await canvas.boundingBox()
      if (!box) throw new Error('Expected visible panorama canvas')
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6, { steps: 12 })
      await page.mouse.up()
      await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false)
      await page.getByRole('button', { name: '重置视角', exact: true }).click()
      await page.locator('.psv-marker button, button.psv-marker').first().click()
      await expect(canvas).toHaveCount(0)
      await load.click()
      await expect(page.getByRole('status')).toContainText('拖动查看四周')
      await expect(canvas).toBeVisible()
      await expect(page.locator('.psv-canvas-container')).toHaveCSS('opacity', '1')
      await page.screenshot({ path: testInfo.outputPath(`${target}-second-residence.png`) })
      await page.evaluate(() => {
        const dispose = Reflect.get(globalThis, '__openpencilDisposeVRTour')
        if (typeof dispose === 'function') dispose()
      })
      await expect(canvas).toHaveCount(0)
      const resources = await probe.evaluate((value) => value.snapshot())
      expect(resources.active).toEqual([])
      expect(resources.deletedTextures).toBeGreaterThan(0)
      expect(
        requests.filter((url) => !url.startsWith('blob:') && !url.startsWith('data:'))
      ).toEqual([])
      expect(errors).toEqual([])
      await probe.evaluate((value) => value.restore())
      await probe.dispose()
    } finally {
      await server.close()
    }
  })
}
