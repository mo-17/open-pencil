import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { Page, TestInfo } from '@playwright/test'

import type { FontManager } from '@open-pencil/core/text'

import { CanvasHelper } from '#tests/helpers/canvas'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'

/** Exercise the real file-open path; CI generates its own gallery rather than using local output. */
export async function openComponentGallery(
  page: Page,
  info: TestInfo,
  renderer: 'retained' | 'tiled'
) {
  const supplied = process.env.OPENPENCIL_TEMPLATE_FIG_PATH
  const path = supplied ? resolve(supplied) : info.outputPath('all-templates.fig')
  if (!supplied) {
    mkdirSync(dirname(path), { recursive: true })
    execFileSync(
      'bun',
      [
        'tests/helpers/compiler/components/templates/compile-fig.ts',
        'react',
        path,
        '--create-fixture'
      ],
      { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 }
    )
  }
  const bytes = readFileSync(path)
  await trackFontModuleResources(page)
  await mockFontsource(page, [])
  await page.goto(`/?test&renderer=${renderer}&navigation-benchmark`)
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.evaluate(async (data) => {
    const moduleURL = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => url.includes('/packages/core/src/text/fonts.ts'))
    if (!moduleURL) throw new Error('Font manager unavailable')
    const { fontManager } = (await import(/* @vite-ignore */ moduleURL)) as {
      fontManager: FontManager
    }
    const response = await fetch('/tests/fixtures/fonts/NotoSansSC-Regular.ttf')
    if (!response.ok) throw new Error('Licensed local CJK font unavailable')
    fontManager.markLoaded('Noto Sans SC', 'Regular', await response.arrayBuffer())
    fontManager.setCJKFallbackFamily('Noto Sans SC')
    await window.openPencil
      .getStore()
      .openFigFile(new File([new Uint8Array(data)], 'all-templates.fig'))
  }, Array.from(bytes))
  return { canvas, path, bytes }
}
