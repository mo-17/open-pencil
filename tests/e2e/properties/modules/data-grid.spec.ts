import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test('DataGrid CSV tools default off and remain reversible and local to the selected grid', async ({
  page
}, info) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  const views = page.getByTestId('settings-plugins-view')
  await views.getByText('Browse', { exact: true }).click()
  await page.getByTestId('plugin-discover-search').fill('Data Grid')
  await page.getByTestId('plugin-install-open-pencil.data-grid').click()
  await expect(page.getByTestId('plugin-installed-open-pencil.data-grid')).toBeVisible()
  await views.getByText('Installed', { exact: true }).click()
  const enabled = page.getByTestId('plugin-enabled-open-pencil.data-grid')
  await expect(enabled).not.toBeChecked()
  await enabled.click()
  await expect(enabled).toBeChecked()
  await page.getByTestId('app-settings-done').click()

  const insert = page.getByTestId('toolbar-plugin-module-open-pencil.data-grid-data-grid')
  await page.getByTestId('toolbar-plugin-modules').click()
  await insert.click()
  const toggle = page.getByRole('checkbox', { name: 'Show CSV import/export tools', exact: true })
  await expect(toggle).toBeVisible()
  await expect(toggle).not.toBeChecked()
  await expect(toggle).toHaveAccessibleDescription(
    'These tools are hidden by default in previews and exports. Enable only when users need to paste or copy table data.'
  )
  await toggle.check()
  await toggle.blur()
  await canvas.undo()
  await expect(toggle).not.toBeChecked()
  await canvas.redo()
  await expect(toggle).toBeChecked()

  await page.getByTestId('layers-item').filter({ hasText: 'Advanced Data Grid' }).dblclick()
  await page.getByTestId('layers-item-input').fill('Grid with CSV')
  await page.getByTestId('layers-item-input').press('Enter')
  await page.getByTestId('toolbar-plugin-modules').click()
  await insert.click()
  await expect(toggle).not.toBeChecked()
  await page.getByTestId('layers-item').filter({ hasText: 'Grid with CSV' }).click()
  await expect(toggle).toBeChecked()
  await page.getByTestId('layers-item').filter({ hasText: 'Advanced Data Grid' }).click()
  await expect(toggle).not.toBeChecked()
  await page.screenshot({ path: info.outputPath('data-grid-csv-switch.png') })
  canvas.assertNoErrors()
})
