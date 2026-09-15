import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, test } from '@playwright/test'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

import { installTourResourceProbe } from '#tests/helpers/compiler/vr-tour'

const realAssets = process.env.OPENPENCIL_VR_REAL_ASSETS
const firstImage = realAssets
  ? '/assets/vr-tour/cayley_interior.jpg'
  : '/assets/vr-tour/living-room.png'
const secondImage = realAssets ? '/assets/vr-tour/lebombo.jpg' : '/assets/vr-tour/bedroom.png'

for (const target of ['react', 'vue'] as const) {
  test(`${target} ${realAssets ? 'real residential 8K JPEG' : 'synthetic panorama'} WebGL tour loads on consent, rotates, changes rooms and revokes resources`, async ({
    page
  }, testInfo) => {
    test.setTimeout(90000)
    const emitted = execFileSync(
      'bun',
      [
        '-e',
        `import { runtimeFiles } from './tests/engine/compiler/vr-tour/helpers'; process.stdout.write(JSON.stringify([...runtimeFiles('${target}', ${Boolean(realAssets)})]))`
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    // Exercise the public built sidecar; Playwright aliases source imports to
    // Bun-only TS, which cannot be loaded directly by Node's JSON module loader.
    const { createPreviewServer } = await import(
      pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
    )
    const server: PreviewServer = await createPreviewServer({
      initialFiles: new Map(JSON.parse(emitted)),
      target
    })
    const requests: string[] = []
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    let image = Buffer.alloc(0)
    const realImages = realAssets
      ? new Map(
          [firstImage, secondImage].map((url) => [
            url,
            readFileSync(join(realAssets, basename(url)))
          ])
        )
      : undefined
    let holdResponse = false
    let failResponse = false
    let releaseResponse: (() => void) | undefined
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    await page.route('**/assets/vr-tour/*', async (route) => {
      const path = new URL(route.request().url()).pathname
      requests.push(path)
      if (holdResponse) await responseGate
      await route.fulfill({
        status: failResponse ? 503 : 200,
        contentType: realImages ? 'image/jpeg' : 'image/png',
        body: realImages ? realImages.get(path) : image
      })
    })
    try {
      await page.goto(server.url)
      await page.getByRole('button', { name: 'Load panorama', exact: true }).waitFor()
      const data = realImages
        ? ''
        : await page.evaluate(() => {
            const canvas = document.createElement('canvas')
            canvas.width = 1024
            canvas.height = 512
            const ctx = canvas.getContext('2d')
            if (!ctx) throw new Error('Canvas 2D is required for this test fixture')
            for (let x = 0; x < 1024; x += 32) {
              ctx.fillStyle = 'hsl(' + (x / 1024) * 360 + ',80%,45%)'
              ctx.fillRect(x, 0, 32, 512)
              ctx.fillStyle = '#ffffff'
              ctx.fillRect(x, 96, 12, 32)
            }
            return canvas.toDataURL('image/png').split(',')[1]
          })
      image = Buffer.from(data, 'base64')
      expect(requests).toEqual([])
      const probe = await installTourResourceProbe(page)
      try {
        await page.getByRole('button', { name: 'Load panorama', exact: true }).click()
        await page.getByRole('status').filter({ hasText: 'Drag to look around' }).waitFor()
        expect(requests).toEqual([firstImage])
        const canvas = page.locator('.psv-canvas')
        expect(await canvas.count()).toBe(1)
        await expect(page.locator('.psv-canvas-container')).toHaveCSS('opacity', '1')
        await page.screenshot({ path: testInfo.outputPath('vr-tour-loaded.png') })
        const before = await canvas.screenshot()
        const region = page.getByRole('region', { name: /360° panorama/ })
        await region.focus()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('+')
        await page.waitForTimeout(100)
        expect((await canvas.screenshot()).equals(before)).toBe(false)
        await page
          .getByRole('button', {
            name: `${realImages ? 'Sample B' : 'Bedroom'}. Select room; then load its panorama.`
          })
          .click()
        expect(await canvas.count()).toBe(0)
        expect(requests).toHaveLength(1)
        expect(await probe.evaluate((value) => value.snapshot().active.length)).toBe(0)
        expect(await probe.evaluate((value) => value.snapshot().deletedTextures)).toBeGreaterThan(0)
        await page.getByRole('button', { name: 'Load panorama', exact: true }).click()
        await page.getByRole('status').filter({ hasText: 'Drag to look around' }).waitFor()
        expect(requests.at(-1)).toBe(secondImage)
        await expect(page.locator('.psv-canvas-container')).toHaveCSS('opacity', '1')
        await page.screenshot({ path: testInfo.outputPath('vr-tour-second-scene.png') })
        await page.getByRole('button', { name: 'Bind listing', exact: true }).click()
        expect(await canvas.count()).toBe(0)
        expect(await probe.evaluate((value) => value.snapshot().active.length)).toBe(0)
        expect(requests).toHaveLength(2)
        await page.getByRole('button', { name: 'Invalid listing', exact: true }).click()
        await page.getByRole('status').filter({ hasText: 'Invalid panorama URL' }).waitFor()
        expect(
          await page.getByRole('button', { name: 'Load panorama', exact: true }).isDisabled()
        ).toBe(true)
        await page.getByRole('button', { name: 'Missing listing', exact: true }).click()
        expect(
          await page.getByRole('button', { name: 'Load panorama', exact: true }).isDisabled()
        ).toBe(true)
        expect(requests).toHaveLength(2)
        holdResponse = true
        await page.getByRole('button', { name: 'Alternate listing', exact: true }).click()
        await page.getByRole('button', { name: 'Load panorama', exact: true }).click()
        await page.getByRole('status').filter({ hasText: 'Loading panorama…' }).waitFor()
        await expect.poll(() => requests.length).toBe(3)
        await page.getByRole('button', { name: 'Missing listing', exact: true }).click()
        await page.getByRole('status').filter({ hasText: 'Invalid panorama URL' }).waitFor()
        holdResponse = false
        releaseResponse?.()
        await page.waitForTimeout(100)
        expect(await canvas.count()).toBe(0)
        expect(await probe.evaluate((value) => value.snapshot().active.length)).toBe(0)
        expect(
          await page.getByRole('button', { name: 'Load panorama', exact: true }).isDisabled()
        ).toBe(true)
        await page.getByRole('button', { name: 'Alternate listing', exact: true }).click()
        await page.getByRole('button', { name: 'Load panorama', exact: true }).click()
        await page.getByRole('status').filter({ hasText: 'Drag to look around' }).waitFor()
        expect(requests.at(-1)).toBe(realImages ? secondImage : '/assets/vr-tour/alternate.png')
        failResponse = true
        await page.getByRole('button', { name: 'Load panorama', exact: true }).click()
        await page.getByRole('status').filter({ hasText: 'Panorama request failed' }).waitFor()
        expect(await canvas.count()).toBe(0)
        expect(await probe.evaluate((value) => value.snapshot().active.length)).toBe(0)
        failResponse = false
        await page.getByRole('button', { name: 'Load panorama', exact: true }).click()
        await page.getByRole('status').filter({ hasText: 'Drag to look around' }).waitFor()
        expect(await canvas.count()).toBe(1)
        await page.getByRole('button', { name: 'Toggle tour', exact: true }).click()
        expect(await canvas.count()).toBe(0)
        expect(await probe.evaluate((value) => value.snapshot().active.length)).toBe(0)
        expect(errors).toEqual([])
      } finally {
        await probe.evaluate((value) => value.restore())
        await probe.dispose()
      }
    } finally {
      releaseResponse?.()
      await server.close()
    }
  })
}
