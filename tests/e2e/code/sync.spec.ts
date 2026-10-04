import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import {
  createPreviewSyncMarker,
  openPreviewSyncDocument,
  savePreviewSyncDocument,
  updatePreviewSyncMarker
} from '#tests/helpers/compiler/preview-sync'

test('React: Auto, On save and Manual update the preview and retain the preference', async ({
  page
}) => {
  test.setTimeout(150000)
  await page.setViewportSize({ width: 2200, height: 1000 })
  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
  await openPreviewSyncDocument(page)
  await new CanvasHelper(page).waitForInit()
  const pane = page.getByTestId('lowcode-preview-pane')
  await expect(pane).toHaveAttribute('data-preview-status', 'ready', { timeout: 60000 })
  const body = page.frameLocator('iframe[aria-label="lowcode preview"]').locator('body')
  const selector = page.getByTestId('lowcode-preview-refresh-policy')
  const choose = async (mode: string) => {
    await selector.selectOption(mode)
  }
  await expect(selector).toHaveValue('auto')
  await expect(selector.locator('option')).toHaveCount(4)

  const id = await createPreviewSyncMarker(page, 'Automatic marker')
  await expect(body).toContainText('Automatic marker', { timeout: 60000 })
  await choose('save')
  await updatePreviewSyncMarker(page, id, 'Saved marker')
  await page.waitForTimeout(1200)
  await expect(body).toContainText('Automatic marker')
  await expect(body).not.toContainText('Saved marker')
  await savePreviewSyncDocument(page)
  await expect(body).toContainText('Saved marker', { timeout: 60000 })

  await choose('manual')
  await updatePreviewSyncMarker(page, id, 'Manual marker')
  await savePreviewSyncDocument(page)
  await page.waitForTimeout(1200)
  await expect(body).toContainText('Saved marker')
  await expect(body).not.toContainText('Manual marker')
  await page.getByRole('button', { name: '↻', exact: true }).click()
  await expect(body).toContainText('Manual marker', { timeout: 60000 })

  await page.getByTestId('flutter-preview-controls').locator('summary').first().click()
  await expect(page.getByTestId('flutter-preview-start')).toHaveCount(0)
  await page.reload()
  await new CanvasHelper(page).waitForInit()
  await expect(selector).toHaveValue('manual')
})

test('Vue browser preview reports its unsupported sandbox boundary', async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 1000 })
  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
  const pane = page.getByTestId('lowcode-preview-pane')
  await expect(pane).toHaveAttribute('data-preview-status', 'ready', { timeout: 60000 })
  await page.getByTestId('lowcode-preview-target').selectOption('vue')
  await expect(pane).toHaveAttribute('data-preview-status', 'unsupported', { timeout: 30000 })
  await expect(page.locator('iframe[aria-label="lowcode preview"]')).toHaveCount(0)
  await page.getByTestId('lowcode-preview-diagnostics-toggle').click()
  await expect(page.getByTestId('lowcode-preview-diagnostics')).toContainText(
    'browser-preview-vue-unsupported'
  )
})
