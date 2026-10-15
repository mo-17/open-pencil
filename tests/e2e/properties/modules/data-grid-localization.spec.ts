import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test.use({ viewport: { width: 1600, height: 1100 } })

test('DataGrid inspector switches English and Chinese labels without changing stored options', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const pluginId = 'open-pencil.data-grid'
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await page.getByTestId('settings-plugins-view').getByText('Browse', { exact: true }).click()
  await page.getByTestId('plugin-discover-search').fill('Data Grid')
  await page.getByTestId(`plugin-install-${pluginId}`).click()
  await expect(page.getByTestId(`plugin-installed-${pluginId}`)).toBeVisible()
  await page.getByTestId(`plugin-enabled-${pluginId}`).click()
  await expect(page.getByTestId(`plugin-enabled-${pluginId}`)).toBeChecked()
  await page.getByTestId('app-settings-done').click()
  await page.getByTestId('toolbar-plugin-modules').click()
  await page.getByTestId(`toolbar-plugin-module-${pluginId}-data-grid`).click()

  const selection = page.getByRole('combobox', { name: 'Row selection', exact: true })
  const density = page.getByRole('combobox', { name: 'Row density', exact: true })
  await expect(selection.locator('option')).toHaveText([
    'No row selection',
    'Single row',
    'Multiple rows'
  ])
  await expect(density.locator('option')).toHaveText(['Compact', 'Comfortable'])
  await selection.selectOption('multiple')
  await density.selectOption('comfortable')
  const before = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil.getStore()
    const owner = editor.graph.getNode([...editor.state.selectedIds][0])
    if (!owner) throw new Error('DataGrid missing')
    return JSON.stringify(owner.interactiveProps?.module)
  })

  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-general').click()
  await page.getByTestId('settings-language').click()
  await page.getByRole('option', { name: '中文（简体）', exact: true }).click()
  await page.getByTestId('app-settings-done').click()
  const chineseSelection = page.getByRole('combobox', { name: '行选择方式', exact: true })
  const chineseDensity = page.getByRole('combobox', { name: '行密度', exact: true })
  await expect(chineseSelection.locator('option')).toHaveText([
    '不允许选行',
    '单行选择',
    '多行选择'
  ])
  await expect(chineseDensity.locator('option')).toHaveText(['紧凑', '宽松'])
  await expect(chineseSelection).toHaveValue('multiple')
  await expect(chineseDensity).toHaveValue('comfortable')
  await expect(page.getByRole('checkbox', { name: '固定表头', exact: true })).toBeVisible()
  const after = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil.getStore()
    return JSON.stringify(
      editor.graph.getNode([...editor.state.selectedIds][0])?.interactiveProps?.module
    )
  })
  expect(after).toBe(before)
  await page.screenshot({ path: info.outputPath('data-grid-chinese-inspector.png') })
  canvas.assertNoErrors()
})
