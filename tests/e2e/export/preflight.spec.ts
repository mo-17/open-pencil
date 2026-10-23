import { readFile } from 'node:fs/promises'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import {
  countRedExportPixels,
  createMissingImageExportFixture,
  repairExportFixture
} from '#tests/helpers/document/export-preflight'

const editor = useEditorSetup('/?test')

test('export preflight locates a missing resource and repaired export contains actual pixels', async () => {
  const { page } = editor
  const id = await page.evaluate(createMissingImageExportFixture)
  await page.getByTestId('export-button').click()
  const dialog = page.getByRole('dialog', { name: 'Export preflight', exact: true })
  const issue = dialog.locator('[data-export-issue="missing-image"]')
  await expect(issue).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('export-preflight.png') })
  await issue.getByRole('button', { name: 'Locate layer' }).click()
  await expect(dialog).toBeHidden()
  await page.evaluate(repairExportFixture, id)
  await page.locator('[data-property="export-preflight"]').click()
  await expect(dialog.locator('[data-export-issue="missing-image"]')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
  // Native File System Access dialogs are outside headless Playwright. Exercise
  // the existing anchor-download fallback, as the export acceptance suite does.
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined
  })
  const pending = page.waitForEvent('download')
  await page.getByTestId('export-button').click()
  const download = await pending
  const path = await download.path()
  if (!path) throw new Error('Export download is unavailable')
  const bytes = await readFile(path)
  expect(bytes.readUInt32BE(16)).toBe(80)
  expect(bytes.readUInt32BE(20)).toBe(60)
  expect(await page.evaluate(countRedExportPixels, [...bytes])).toBeGreaterThan(4_000)
})
