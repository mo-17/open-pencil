import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '#tests/e2e/fixtures'
import {
  captureComponentStateCanvas,
  componentStateCanvasMetrics,
  openComponentStateCanvas,
  zoomComponentStateCanvas
} from '#tests/helpers/compiler/components/states/canvas'
import { CANVAS_STATE_FAMILIES } from '#tests/helpers/compiler/components/states/types'

test.setTimeout(120_000)
test.use({ viewport: { width: 1400, height: 1100 } })

for (const renderer of ['retained', 'tiled'] as const)
  for (const locale of ['en', 'zh-CN'] as const)
    for (const family of CANVAS_STATE_FAMILIES)
      test(`${renderer} ${locale} ${family} draws authored states after FIG import, font fallback and viewport changes`, async ({
        page
      }, info) => {
        const { canvas, rootId } = await openComponentStateCanvas(page, family, locale, renderer)
        const beforeExport = await componentStateCanvasMetrics(page, rootId)
        const image = await captureComponentStateCanvas(page, rootId)
        expect(image.byteLength).toBeGreaterThan(1000)
        expect(image).toMatchSnapshot(`${family}-${locale}.png`, {
          maxDiffPixels: 0,
          threshold: 0.2
        })
        const afterExport = await componentStateCanvasMetrics(page, rootId)
        await zoomComponentStateCanvas(page, rootId, 16)
        const metricsPath = info.outputPath('canvas-fit-metrics.json')
        mkdirSync(info.outputPath(), { recursive: true })
        writeFileSync(
          metricsPath,
          JSON.stringify(
            {
              beforeExport,
              afterExport,
              afterFit: await componentStateCanvasMetrics(page, rootId)
            },
            null,
            2
          )
        )
        await info.attach('canvas-fit-metrics', {
          path: metricsPath,
          contentType: 'application/json'
        })
        await expect(canvas.canvas).toHaveScreenshot(`${renderer}-${family}-${locale}-fit.png`, {
          animations: 'disabled'
        })
        await zoomComponentStateCanvas(page, rootId, 140)
        await expect(canvas.canvas).toHaveScreenshot(`${renderer}-${family}-${locale}-zoomed.png`, {
          animations: 'disabled'
        })
        await info.attach(`${family}-${locale}-canvas`, { body: image, contentType: 'image/png' })
        const directory = process.env.OPENPENCIL_COMPONENT_STATE_GALLERY_DIR
        if (directory) {
          mkdirSync(directory, { recursive: true })
          writeFileSync(join(directory, `${family}-canvas-${locale}.png`), image)
        }
        canvas.assertNoErrors()
      })
