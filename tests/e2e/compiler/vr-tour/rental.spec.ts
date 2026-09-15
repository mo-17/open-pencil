import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, test } from '@playwright/test'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

import { installTourResourceProbe } from '#tests/helpers/compiler/vr-tour'
import {
  generatedRentalFixture,
  installRentalPanoramaRoutes,
  rentalPanoramaAssets
} from '#tests/helpers/compiler/vr-tour/rental'

const assetsDirectory = process.env.OPENPENCIL_VR_REAL_ASSETS

for (const target of ['react', 'vue'] as const) {
  test(`${target} complete rental pages bind real house panoramas and release resources on selection and navigation`, async ({
    page
  }, testInfo) => {
    test.skip(
      !assetsDirectory,
      'Set OPENPENCIL_VR_REAL_ASSETS to local real-house JPEG assets; no network downloads run in CI.'
    )
    test.setTimeout(120000)
    if (!assetsDirectory) throw new Error('Real house panorama directory is required')
    const assets = rentalPanoramaAssets(assetsDirectory)
    const fixture = generatedRentalFixture(target)
    const { createPreviewServer } = await import(
      pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
    )
    const server: PreviewServer = await createPreviewServer({ initialFiles: fixture.files, target })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      const routes = await installRentalPanoramaRoutes(page, fixture, server.url, assets)
      const entryURL = new URL(fixture.entryPath, server.url).href
      // The unconnected VFS sidecar only serves its generated entry at the root.
      await page.route(entryURL, async (route) =>
        route.fulfill({ response: await route.fetch({ url: server.url }) })
      )
      const response = await page.goto(entryURL)
      expect(response?.status()).toBe(200)
      const select = page.getByRole('button', { name: 'Select record', exact: true })
      await expect(select).toHaveCount(2)
      await expect(page.getByText('Property: Cayley interior home', { exact: true })).toBeVisible()
      const load = page.getByRole('button', { name: 'Load panorama', exact: true })
      const canvas = page.locator('.psv-canvas')
      const region = page.getByRole('region', { name: /360° panorama/ })
      await expect(load).toHaveCount(0)
      expect(routes.images).toEqual([])
      const probe = await installTourResourceProbe(page)
      try {
        await select.nth(0).click()
        await expect(load).toBeEnabled()
        await expect(
          page.getByText('Loads image from: ' + assets[0].path, { exact: true })
        ).toBeVisible()
        await expect(canvas).toHaveCount(0)
        expect(routes.images).toEqual([])
        await load.click()
        await expect(
          page.getByRole('status').filter({ hasText: 'Drag to look around' })
        ).toBeVisible({ timeout: 30000 })
        await expect(canvas).toHaveCount(1)
        expect(
          await canvas.evaluate((element) => {
            if (!(element instanceof HTMLCanvasElement)) return false
            const context = element.getContext('webgl2')
            return Boolean(
              context &&
              !context.isContextLost() &&
              context.drawingBufferWidth > 0 &&
              context.drawingBufferHeight > 0
            )
          })
        ).toBe(true)
        expect(routes.images).toEqual([
          { path: assets[0].path, method: 'GET', referer: undefined, cookie: undefined }
        ])
        const firstResources = await probe.evaluate((value) => value.snapshot())
        expect(firstResources.active).toHaveLength(1)
        const firstCanvas = await canvas.elementHandle()
        await region.scrollIntoViewIfNeeded()
        await expect(page.locator('.psv-canvas-container')).toHaveCSS('opacity', '1')
        await page.screenshot({ path: testInfo.outputPath('rental-cayley-loaded.png') })
        await canvas.screenshot({ path: testInfo.outputPath('rental-cayley-webgl.png') })

        await select.nth(1).click()
        await expect(
          page.getByText('Loads image from: ' + assets[1].path, { exact: true })
        ).toBeVisible()
        await expect(load).toBeEnabled()
        await expect(canvas).toHaveCount(0)
        await expect.poll(() => firstCanvas.evaluate((element) => element.isConnected)).toBe(false)
        await firstCanvas.dispose()
        await expect
          .poll(async () => (await probe.evaluate((value) => value.snapshot())).active.length)
          .toBe(0)
        const changedResources = await probe.evaluate((value) => value.snapshot())
        expect(changedResources.revoked).toContain(firstResources.active[0])
        expect(changedResources.deletedTextures).toBeGreaterThan(firstResources.deletedTextures)
        expect(routes.images).toHaveLength(1)
        await page.screenshot({ path: testInfo.outputPath('rental-lebombo-awaiting-consent.png') })

        await load.click()
        await expect(
          page.getByRole('status').filter({ hasText: 'Drag to look around' })
        ).toBeVisible({ timeout: 30000 })
        await expect(canvas).toHaveCount(1)
        expect(routes.images.map((image) => image.path)).toEqual(assets.map((asset) => asset.path))
        const secondResources = await probe.evaluate((value) => value.snapshot())
        expect(secondResources.active).toHaveLength(1)
        expect(secondResources.active[0]).not.toBe(firstResources.active[0])
        const secondCanvas = await canvas.elementHandle()
        await region.scrollIntoViewIfNeeded()
        await expect(page.locator('.psv-canvas-container')).toHaveCSS('opacity', '1')
        await page.screenshot({ path: testInfo.outputPath('rental-lebombo-loaded.png') })
        await canvas.screenshot({ path: testInfo.outputPath('rental-lebombo-webgl.png') })

        await page.getByRole('button', { name: 'Viewing appointments', exact: true }).click()
        await page.waitForURL(new URL(fixture.exitPath, server.url).href)
        await expect(region).toHaveCount(0)
        await expect(canvas).toHaveCount(0)
        await expect.poll(() => secondCanvas.evaluate((element) => element.isConnected)).toBe(false)
        await secondCanvas.dispose()
        await expect
          .poll(async () => (await probe.evaluate((value) => value.snapshot())).active.length)
          .toBe(0)
        const finalResources = await probe.evaluate((value) => value.snapshot())
        expect(finalResources.revoked).toContain(secondResources.active[0])
        expect(finalResources.deletedTextures).toBeGreaterThan(secondResources.deletedTextures)
        expect(routes.images).toHaveLength(2)
        expect(routes.images.every((image) => !image.cookie && !image.referer)).toBe(true)
        for (const property of routes.properties)
          expect(routes.reads).toContain('/rental-properties/' + property.id)
        await expect.poll(() => routes.reads.includes('/rental-viewings')).toBe(true)
        expect(routes.failures).toEqual([])
        expect(errors).toEqual([])
        await page.screenshot({ path: testInfo.outputPath('rental-viewings-after-unmount.png') })
        await testInfo.attach('rental-real-panorama-evidence', {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              target,
              entry: fixture.entryPath,
              exit: fixture.exitPath,
              assets: assets.map(({ filename, body, sha256 }) => ({
                filename,
                bytes: body.length,
                sha256
              })),
              images: routes.images,
              reads: routes.reads,
              resources: finalResources,
              errors
            },
            null,
            2
          )
        })
      } finally {
        await probe.evaluate((value) => value.restore())
        await probe.dispose()
      }
    } finally {
      await server.close()
    }
  })
}
