import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { serveTourExport } from '#tests/helpers/compiler/vr-tour'

const exportRoot = process.env.OPENPENCIL_VR_EXPORT_ROOT
const assets = process.env.OPENPENCIL_VR_REAL_ASSETS

for (const target of ['react', 'vue'] as const) {
  test(`${target} production export serves real residential panoramas and supports mouse navigation`, async ({
    page
  }, testInfo) => {
    test.skip(
      !exportRoot || !assets,
      'Provide locally built exports and CC0 residential fixtures explicitly'
    )
    if (!exportRoot || !assets) return
    test.setTimeout(60000)
    const server = await serveTourExport(join(exportRoot, target, 'dist'))
    const requests: string[] = []
    const errors: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/assets/vr-tour/')) requests.push(request.url())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.goto(server.url)
      const load = page.getByRole('button', { name: 'Load panorama', exact: true })
      await expect(load).toBeVisible()
      expect(requests).toEqual([])
      for (const [index, file] of ['cayley_interior.jpg', 'lebombo.jpg'].entries()) {
        const response = page.waitForResponse(server.url + '/assets/vr-tour/' + file)
        await load.click()
        const served = await response
        expect(served.status()).toBe(200)
        expect(served.headers()['content-type']).toBe('image/jpeg')
        expect(
          createHash('sha256')
            .update(await served.body())
            .digest('hex')
        ).toBe(
          createHash('sha256')
            .update(readFileSync(join(assets, file)))
            .digest('hex')
        )
        await expect(page.getByRole('status')).toContainText('Drag to look around')
        const canvas = page.locator('.psv-canvas')
        await expect(canvas).toBeVisible()
        await expect(page.locator('.psv-canvas-container')).toHaveCSS('opacity', '1')
        await page.screenshot({ path: testInfo.outputPath(`export-${file}.png`) })
        const before = await canvas.screenshot()
        const box = await canvas.boundingBox()
        if (!box) throw new Error('Panorama canvas must have visible bounds')
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.7, { steps: 12 })
        await page.mouse.up()
        await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false)
        if (index === 0) {
          await page.getByRole('region', { name: /360° panorama/ }).focus()
          await page.keyboard.press('Home')
          await page
            .getByRole('button', { name: 'Sample B. Select room; then load its panorama.' })
            .click()
          await expect(canvas).toHaveCount(0)
          expect(requests).toHaveLength(1)
        }
      }
      expect(requests).toHaveLength(2)
      expect(errors).toEqual([])
    } finally {
      await server.close()
    }
  })
}
