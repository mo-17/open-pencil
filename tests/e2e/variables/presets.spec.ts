import { expect, test, type Locator } from '@playwright/test'
import { escapeRegExp } from 'es-toolkit/string'

import { CanvasHelper } from '#tests/helpers/canvas'
import { propertyField } from '#tests/helpers/properties'

/** The same collection entry is a sidebar button in wide dialogs and a tab in medium ones. */
function collectionEntry(variables: Locator, name: string) {
  return variables.getByTestId('variables-collection-tab').filter({
    hasText: new RegExp(`^${escapeRegExp(name)}(?:\\s*\\d+)?$`)
  })
}

async function expectActiveCollection(variables: Locator, name: string): Promise<void> {
  const entry = collectionEntry(variables, name)
  await expect(entry).toBeVisible()
  await expect
    .poll(() =>
      entry.evaluate((element) =>
        element.getAttribute('role') === 'tab'
          ? element.getAttribute('aria-selected')
          : element.getAttribute('aria-current')
      )
    )
    .toBe('true')
  await expect(variables.getByRole('listbox', { name, exact: true })).toBeVisible()
}

test('preview, cancel, import and revisit an optional design preset', async ({ page }) => {
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const openVariables = page
    .getByRole('region', { name: 'Variables' })
    .getByRole('button', { name: 'Open variables' })
  await openVariables.click()
  const variables = page.getByTestId('variables-dialog')
  await variables.getByRole('button', { name: 'Design system presets' }).click()
  const presets = page.getByRole('dialog', { name: 'Design system presets', exact: true })
  await presets.getByRole('radio', { name: /^Soft/ }).click()
  await expect(
    presets.getByRole('table', { name: 'Variable preview' }).getByRole('row')
  ).toHaveCount(13)
  await expect(presets.getByText('Only adds a variable collection')).toBeVisible()
  await presets.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(presets).toBeHidden()
  await expect(variables.getByText('No variable collections')).toBeVisible()
  await expect(variables.getByRole('button', { name: 'Design system presets' })).toBeFocused()

  await variables.getByRole('button', { name: 'Design system presets' }).click()
  await presets.getByRole('radio', { name: /^Business/ }).click()
  await presets.getByRole('button', { name: 'Import as new collection' }).click()
  await expect(presets).toBeHidden()
  await expectActiveCollection(variables, 'Business')
  await expect(variables.getByTestId('variable-row')).toHaveCount(12)
  await expect(variables.getByText('Preset imported', { exact: true })).toBeVisible()
  await expect(variables.getByRole('button', { name: 'Design system presets' })).toBeFocused()

  await variables.getByRole('button', { name: 'Design system presets' }).click()
  await expect(presets.getByRole('heading', { name: 'New collection: Business (2)' })).toBeVisible()
  await presets.getByRole('button', { name: 'Import as new collection' }).click()
  await expectActiveCollection(variables, 'Business (2)')
  await collectionEntry(variables, 'Business').click()
  await expect(variables.getByTestId('variable-row')).toHaveCount(12)
  await page.keyboard.press('Escape')
  await expect(variables).toBeHidden()
  await openVariables.click()
  await expect(collectionEntry(variables, 'Business')).toBeVisible()
  await expect(collectionEntry(variables, 'Business (2)')).toBeVisible()
  await page.keyboard.press('Escape')
  // Editor shortcuts stay blocked while Reka's closing dialog still owns its layer.
  await expect(variables).toHaveCount(0)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await openVariables.click()
  await expect(collectionEntry(variables, 'Business (2)')).toHaveCount(0)
  await expectActiveCollection(variables, 'Business')
  await expect(variables.getByTestId('variable-row')).toHaveCount(12)
  canvas.assertNoErrors()
})

test('a preset becomes active only after binding and can be detached', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page
    .getByRole('region', { name: 'Variables' })
    .getByRole('button', { name: 'Open variables' })
    .click()
  const variables = page.getByTestId('variables-dialog')
  await variables.getByRole('button', { name: 'Design system presets' }).click()
  const presets = page.getByRole('dialog', { name: 'Design system presets', exact: true })
  await presets.getByRole('radio', { name: /^Soft/ }).click()
  await presets.getByRole('button', { name: 'Import as new collection' }).click()
  await expect(presets).toHaveCount(0)
  await expect(collectionEntry(variables, 'Soft')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(variables).toHaveCount(0)
  await canvas.drawRect(200, 200, 160, 100)
  const radius = propertyField(page, 'cornerRadius')
  await expect(radius).not.toHaveAttribute('data-bound')
  await expect(radius).toHaveAttribute('role', 'spinbutton')
  await expect(radius).toHaveAttribute('aria-valuenow', '0')
  await radius.getByRole('button', { name: 'Apply variable' }).click()
  await page.getByRole('option', { name: 'Soft/radius/medium', exact: true }).click()
  await expect(radius).toHaveAttribute('data-bound')
  await expect(radius).toHaveAttribute('aria-valuenow', '16')
  await expect(radius.getByText('Soft/radius/medium', { exact: true })).toBeVisible()
  await radius.getByRole('button', { name: 'Apply variable' }).click()
  await page.getByRole('button', { name: 'Detach variable', exact: true }).click()
  await expect(radius).not.toHaveAttribute('data-bound')
  await expect(radius).toHaveAttribute('aria-valuenow', '16')
  const selectedId = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return [...(window.openPencil?.getStore?.().state.selectedIds ?? [])][0]
  })
  expect(selectedId).toBeTruthy()
  const preview = page.getByTestId('lowcode-preview-pane')
  await expect(preview).toHaveAttribute('data-preview-host', 'browser-worker')
  await expect(preview).toHaveAttribute('data-preview-status', 'ready', { timeout: 45_000 })
  await expect(page.getByTestId('lowcode-preview-compile-activity')).toHaveAttribute(
    'data-in-flight',
    'false'
  )
  await expect(page.getByTestId('lowcode-preview-compile-activity')).toHaveAttribute(
    'data-pending',
    'false'
  )
  await expect(
    page
      .frameLocator('iframe[aria-label="lowcode preview"]')
      .locator(`[data-node-id="${selectedId}"]`)
  ).toHaveCSS('border-radius', '16px')
  canvas.assertNoErrors()
})
