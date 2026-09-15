import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, test } from '@playwright/test'

import { installTourResourceProbe, serveTourExport } from '#tests/helpers/compiler/vr-tour'
import {
  generatedVRTourSampleFixture,
  type VRTourSampleFixture
} from '#tests/helpers/compiler/vr-tour/samples'

const exportRoot = process.env.OPENPENCIL_VR_SAMPLE_EXPORT_ROOT
const sources = exportRoot ? ['real VFS', 'production static export'] : ['real VFS']

async function sampleServer(
  target: 'react' | 'vue',
  fixture: VRTourSampleFixture,
  production: boolean
): Promise<{ url: string; close(): Promise<void> }> {
  if (production) {
    if (!exportRoot) throw new Error('A built sample export directory is required')
    return serveTourExport(join(exportRoot, target, 'dist'))
  }
  const { createPreviewServer } = await import(
    pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
  )
  return createPreviewServer({ initialFiles: fixture.files, target })
}

for (const source of sources) {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} generated Chinese sample page loads pinned 8K images through the ${source}`, async ({
      page
    }, testInfo) => {
      test.setTimeout(120000)
      const fixture = generatedVRTourSampleFixture(target)
      const server = await sampleServer(target, fixture, source === 'production static export')
      const requests: string[] = []
      const errors: string[] = []
      const external: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (fixture.samples.some((sample) => sample.path === url.pathname))
          requests.push(url.pathname)
        if (url.protocol.startsWith('http') && url.origin !== new URL(server.url).origin)
          external.push(url.href)
      })
      try {
        await page.goto(server.url)
        await expect(page.getByText('住宅全景试用', { exact: true })).toBeVisible()
        const tour = page.getByRole('region', { name: '房屋全景导览', exact: true })
        await expect(tour).toHaveAttribute('lang', 'zh-CN')
        const load = page.getByRole('button', { name: '加载全景', exact: true })
        await expect(load).toBeEnabled()
        await expect(page.getByRole('status')).toHaveText('点击“加载全景”后才会读取图片。')
        expect(requests).toEqual([])
        const sourceResponse = await page.request.get(
          new URL('assets/vr-tour/SOURCES.json', server.url).href
        )
        expect(sourceResponse.status()).toBe(200)
        expect(sourceResponse.headers()['content-type']).toBe('application/json')
        const sourceDocument = await sourceResponse.json()
        expect(sourceDocument.descriptionZh).toBe(
          '这些图片展示独立住宅示例，并非同一住宅的相邻房间。'
        )
        expect(sourceDocument.samples).toHaveLength(2)
        expect(
          sourceDocument.samples.every(
            (sample: { license: string }) => sample.license === 'CC0-1.0'
          )
        ).toBe(true)
        const probe = await installTourResourceProbe(page)
        try {
          for (const [index, sample] of fixture.samples.entries()) {
            if (index > 0) {
              await page
                .getByRole('combobox', { name: '全景房间', exact: true })
                .selectOption('bedroom')
              await expect(page.locator('.psv-canvas')).toHaveCount(0)
              await expect(page.getByRole('status')).toHaveText('点击“加载全景”后才会读取图片。')
              expect(requests).toHaveLength(index)
              expect((await probe.evaluate((value) => value.snapshot())).active).toHaveLength(0)
            }
            await expect(page.getByText('图片来源：' + sample.path, { exact: true })).toBeVisible()
            const received = page.waitForResponse(
              (response) => new URL(response.url()).pathname === sample.path
            )
            await load.click()
            const response = await received
            expect(response.status()).toBe(200)
            expect(response.headers()['content-type']).toBe('image/jpeg')
            const bytes = await response.body()
            const original = readFileSync(
              join(process.cwd(), 'packages/demos/vr-tour', sample.fileName)
            )
            expect(bytes.byteLength).toBe(sample.byteLength)
            expect(createHash('sha256').update(bytes).digest('hex')).toBe(sample.sha256)
            expect(bytes.equals(original)).toBe(true)
            await expect(page.getByRole('status')).toHaveText(
              '拖动查看四周 · 按住 Ctrl 滚动滚轮可缩放 · 点击热点切换房间',
              { timeout: 30000 }
            )
            const canvas = page.locator('.psv-canvas')
            await expect(canvas).toHaveCount(1)
            expect(
              await canvas.evaluate((element) => {
                if (!(element instanceof HTMLCanvasElement)) return false
                const context = element.getContext('webgl2')
                return Boolean(
                  context && !context.isContextLost() && context.drawingBufferWidth > 0
                )
              })
            ).toBe(true)
            await expect(page.locator('.psv-canvas-container')).toHaveCSS('opacity', '1')
            await page.screenshot({ path: testInfo.outputPath(`sample-${index + 1}-loaded.png`) })
            expect(requests).toEqual(fixture.samples.slice(0, index + 1).map((asset) => asset.path))
          }
          expect(errors).toEqual([])
          expect(external).toEqual([])
          await testInfo.attach('compiled-sample-evidence', {
            contentType: 'application/json',
            body: JSON.stringify(
              { target, source, samples: fixture.samples, requests, errors, external },
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
}
