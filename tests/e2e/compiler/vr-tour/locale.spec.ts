import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

import { installTourResourceProbe } from '#tests/helpers/compiler/vr-tour'

const realAssets = process.env.OPENPENCIL_VR_REAL_ASSETS
const firstImage = '/assets/vr-tour/cayley_interior.jpg'
const secondImage = '/assets/vr-tour/lebombo.jpg'
const readyMessage = '拖动查看四周 · 按住 Ctrl 滚动滚轮可缩放 · 点击热点切换房间'

async function createChineseTourServer(target: 'react' | 'vue'): Promise<PreviewServer> {
  const emitted = execFileSync(
    'bun',
    [
      '-e',
      `import { runtimeFiles } from './tests/engine/compiler/vr-tour/helpers'; process.stdout.write(JSON.stringify([...runtimeFiles('${target}', true, 'zh-CN')]))`
    ],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
  // The canonical Playwright runner uses Node. Generate with Bun, then load the
  // public built sidecar to avoid Node loading Bun-only TS and JSON source aliases.
  const { createPreviewServer } = await import(
    pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
  )
  return createPreviewServer({ initialFiles: new Map(JSON.parse(emitted)), target })
}

async function expectChineseControls(tour: Locator) {
  await expect(tour).toHaveAttribute('lang', 'zh-CN')
  const toolbar = tour.getByRole('toolbar', { name: '全景操作', exact: true })
  await expect(toolbar).toBeVisible()
  for (const name of ['加载全景', '重置视角', '缩小', '放大']) {
    const button = toolbar.getByRole('button', { name, exact: true })
    await expect(button).toBeVisible()
    await expect(button).toHaveAttribute('title', name)
  }
  await expect(toolbar.getByRole('combobox', { name: '全景房间', exact: true })).toBeVisible()
  await expect(tour.getByRole('status')).toHaveText('点击“加载全景”后才会读取图片。')
  await expect(tour.getByText('图片来源：' + firstImage, { exact: true })).toBeVisible()
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} Chinese VR controls, PSV hints and recoverable errors use explicit locale`, async ({
    page
  }, testInfo) => {
    test.skip(
      !realAssets,
      'Set OPENPENCIL_VR_REAL_ASSETS to the local residential 8K sample directory'
    )
    test.setTimeout(120000)
    if (!realAssets) return
    const images = new Map(
      [firstImage, secondImage].map((url) => [url, readFileSync(join(realAssets, basename(url)))])
    )
    const requests: string[] = []
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    let responseMode: 'image' | 'unavailable' | 'invalid-header' = 'image'
    let releaseResponse: (() => void) | undefined
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    await page.route('**/assets/vr-tour/*', async (route) => {
      const path = new URL(route.request().url()).pathname
      requests.push(path)
      await responseGate
      await route.fulfill({
        status: responseMode === 'unavailable' ? 503 : 200,
        contentType: 'image/jpeg',
        body:
          responseMode === 'invalid-header' ? Buffer.from('invalid image header') : images.get(path)
      })
    })
    const server = await createChineseTourServer(target)
    try {
      await page.goto(server.url)
      // Authored sample names and the fixture's driver buttons stay in English;
      // locale assertions cover the generated tour's UI and accessible names.
      const tour = page.locator('section[aria-label]')
      await expectChineseControls(tour)
      expect(requests).toEqual([])
      const load = tour.getByRole('button', { name: '加载全景', exact: true })
      const status = tour.getByRole('status')
      const canvas = tour.locator('.psv-canvas')
      const viewport = tour.getByRole('region', {
        name: '360° 全景。拖动查看四周；方向键转动视角，加减键缩放，Home 键复位。',
        exact: true
      })
      const probe = await installTourResourceProbe(page)
      try {
        await load.click()
        await expect(status).toHaveText('正在加载全景…')
        await expect(load).toBeDisabled()
        await expect.poll(() => requests).toEqual([firstImage])
        releaseResponse?.()
        await expect(status).toHaveText(readyMessage)
        await expect(tour.locator('.psv-canvas-container')).toHaveCSS('opacity', '1')
        await expect(canvas).toHaveCount(1)
        await page.screenshot({ path: testInfo.outputPath('vr-tour-zh-loaded.png') })

        const initialView = await canvas.screenshot()
        await tour.getByRole('button', { name: '放大', exact: true }).click()
        await expect.poll(async () => (await canvas.screenshot()).equals(initialView)).toBe(false)
        await viewport.press('ArrowRight')
        await tour.getByRole('button', { name: '重置视角', exact: true }).click()
        await expect.poll(async () => (await canvas.screenshot()).equals(initialView)).toBe(true)
        await tour.getByRole('button', { name: '缩小', exact: true }).click()
        await expect.poll(async () => (await canvas.screenshot()).equals(initialView)).toBe(false)
        await tour.getByRole('button', { name: '重置视角', exact: true }).click()

        await viewport.hover()
        await page.mouse.wheel(0, 100)
        await expect(tour.locator('.psv-overlay-title')).toHaveText(
          '请按住 Ctrl 键并滚动滚轮缩放图片'
        )
        await page.keyboard.press('Control')
        await tour
          .getByRole('button', { name: 'Sample B。选择房间后，再加载该房间的全景。', exact: true })
          .click()
        await expect(canvas).toHaveCount(0)
        await expect(status).toHaveText('点击“加载全景”后才会读取图片。')
        await load.click()
        await expect(status).toHaveText(readyMessage)
        expect(requests).toEqual([firstImage, secondImage])
        await expect(tour.locator('.psv-canvas-container')).toHaveCSS('opacity', '1')
        await page.screenshot({ path: testInfo.outputPath('vr-tour-zh-second-scene.png') })

        responseMode = 'unavailable'
        await load.click()
        await expect(status).toHaveText('全景图片请求失败')
        await expect(load).toBeEnabled()
        await expect(canvas).toHaveCount(0)
        expect(await probe.evaluate((value) => value.snapshot().active.length)).toBe(0)
        responseMode = 'invalid-header'
        await load.click()
        await expect(status).toHaveText(
          '请使用宽高比为 2:1、宽度为 512–8192 像素的 JPG、PNG 或 WebP 等距柱状全景图'
        )
        await expect(load).toBeEnabled()
        await expect(canvas).toHaveCount(0)
        responseMode = 'image'
        await load.click()
        await expect(status).toHaveText(readyMessage)
        await expect(tour.locator('.psv-canvas-container')).toHaveCSS('opacity', '1')
        await expect(canvas).toHaveCount(1)

        const requestCount = requests.length
        await page.getByRole('button', { name: 'Bind listing', exact: true }).click()
        await page.getByRole('button', { name: 'Invalid listing', exact: true }).click()
        await expect(status).toHaveText(
          '全景图片地址无效。请选择包含受支持 JPG、PNG 或 WebP 图片地址的房源。'
        )
        await expect(load).toBeDisabled()
        await expect(tour).toHaveAttribute('lang', 'zh-CN')
        await expect(canvas).toHaveCount(0)
        expect(requests).toHaveLength(requestCount)
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
