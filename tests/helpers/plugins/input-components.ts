import type { Page } from '@playwright/test'

import type { FontManager } from '@open-pencil/core/text'

import type { CanvasHelper } from '#tests/helpers/canvas'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'
import { toolbarFlyoutItemTestId, toolbarFlyoutTestId } from '#tests/helpers/test-ids'

/** Use the repository's licensed local CJK fixture for repeatable canvas evidence. */
export async function prepareInputFonts(page: Page) {
  await trackFontModuleResources(page)
  await mockFontsource(page)
}

export async function loadInputFonts(page: Page) {
  await page.evaluate(async () => {
    const moduleURL = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => url.includes('/packages/core/src/text/fonts.ts'))
    if (!moduleURL) throw new Error('Font manager module not observed')
    const { fontManager } = (await import(/* @vite-ignore */ moduleURL)) as {
      fontManager: FontManager
    }
    const response = await fetch('/tests/fixtures/fonts/NotoSansSC-Regular.ttf')
    if (!response.ok) throw new Error('Licensed local CJK fixture unavailable')
    fontManager.markLoaded('Noto Sans SC', 'Regular', await response.arrayBuffer())
    fontManager.setCJKFallbackFamily('Noto Sans SC')
  })
}

export async function removeInputNode(canvas: CanvasHelper) {
  await canvas.page.getByTestId('toolbar').getByRole('button').first().focus()
  await canvas.deleteSelection()
}

export async function drawInputSelect(canvas: CanvasHelper) {
  await canvas.page.getByTestId(toolbarFlyoutTestId('BUTTON')).click()
  await canvas.page.getByTestId(toolbarFlyoutItemTestId('SELECT_FIELD')).click()
  await canvas.drag(220, 220, 540, 264)
  await canvas.waitForRender()
}
