import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { propertyField } from '#tests/helpers/properties'

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
  await expect(variables.getByRole('tab', { name: 'Business', exact: true })).toHaveAttribute(
    'data-state',
    'active'
  )
  await expect(variables.getByTestId('variable-row')).toHaveCount(12)
  await expect(variables.getByText('Preset imported', { exact: true })).toBeVisible()
  await expect(variables.getByRole('button', { name: 'Design system presets' })).toBeFocused()

  await variables.getByRole('button', { name: 'Design system presets' }).click()
  await expect(presets.getByRole('heading', { name: 'New collection: Business (2)' })).toBeVisible()
  await presets.getByRole('button', { name: 'Import as new collection' }).click()
  await expect(variables.getByRole('tab', { name: 'Business (2)', exact: true })).toHaveAttribute(
    'data-state',
    'active'
  )
  await variables.getByRole('tab', { name: 'Business', exact: true }).click()
  await expect(variables.getByTestId('variable-row')).toHaveCount(12)
  await page.keyboard.press('Escape')
  await expect(variables).toBeHidden()
  await openVariables.click()
  await expect(variables.getByRole('tab', { name: 'Business', exact: true })).toBeVisible()
  await expect(variables.getByRole('tab', { name: 'Business (2)', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  // Editor shortcuts stay blocked while Reka's closing dialog still owns its layer.
  await expect(variables).toHaveCount(0)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await openVariables.click()
  await expect(variables.getByRole('tab', { name: 'Business (2)', exact: true })).toHaveCount(0)
  await expect(variables.getByRole('tab', { name: 'Business', exact: true })).toHaveAttribute(
    'data-state',
    'active'
  )
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
  await expect(variables.getByRole('tab', { name: 'Soft', exact: true })).toBeVisible()
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
  const selectedId = await page.evaluate(
    () => [...(window.openPencil?.getStore?.().state.selectedIds ?? [])][0]
  )
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
