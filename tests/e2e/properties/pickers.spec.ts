import { expect, test } from '#tests/e2e/fixtures'
import { prepareInputFields, savedInputFields } from '#tests/helpers/lowcode/input-fields'
import { colorPickerFixture } from '#tests/helpers/lowcode/pickers'
import {
  expansionField,
  insertExpansionModule,
  prepareExpansionModules,
  selectedExpansionConfig,
  selectedModuleClip,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'
import {
  deferContentCommit,
  selectContentLayer,
  selectedContentNodeId
} from '#tests/helpers/plugins/content-components'
import { prepareInputFonts, loadInputFonts } from '#tests/helpers/plugins/input-components'

test.use({ viewport: { width: 1600, height: 1100 } })

test('color fields preserve invalid hex drafts, string binding and late picker ownership', async ({
  page
}) => {
  const canvas = await prepareInputFields(page),
    ids = await colorPickerFixture(page)
  const value = page.getByTestId('lowcode-interactive-value')
  await value.fill('#abc')
  await value.blur()
  await expect(value).toHaveAttribute('aria-invalid', 'true')
  await expect(value).toHaveValue('#abc')
  expect((await savedInputFields(page, ids.color)).properties?.value).toBe('#2563eb')
  await value.press('Escape')
  await expect(value).toHaveValue('#2563eb')
  await value.fill('#123456')
  await value.blur()
  expect((await savedInputFields(page, ids.color)).properties?.value).toBe('#123456')
  await page.getByTestId('toolbar').getByRole('button').first().focus()
  await canvas.undo()
  await expect(value).toHaveValue('#2563eb')
  await value.fill('#fedcba')
  const late = await deferContentCommit(value)
  try {
    await selectContentLayer(page, ids.other)
    await late.deliver()
    await expect(value).toHaveValue('Keep me')
    await selectContentLayer(page, ids.color)
    await expect(value).toHaveValue('#2563eb')
  } finally {
    await late.dispose()
  }
  const picker = page.getByLabel('Choose color', { exact: true })
  await picker.focus()
  const old = await picker.elementHandle()
  if (!old) throw new Error('Color chooser unavailable')
  try {
    await canvas.click(12, 12)
    await expect(page.getByTestId('design-panel-empty')).toBeVisible()
    await selectContentLayer(page, ids.color)
    await picker.focus()
    await old.evaluate((element) => {
      element.value = '#abcdef'
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(value).toHaveValue('#2563eb')
  } finally {
    await old.dispose()
  }
  const binding = page.getByTestId('lowcode-value-binding-select')
  await expect(binding.locator('option[value="state:number-value"]')).toHaveCount(0)
  await binding.selectOption('state:color-value')
  expect((await savedInputFields(page, ids.color)).binding).toEqual({
    kind: 'ref',
    stateId: 'color-value'
  })
  canvas.assertNoErrors()
})

test('new color picker focus cannot authorize events from a discarded control', async ({
  page
}) => {
  const canvas = await prepareInputFields(page)
  await colorPickerFixture(page)
  const value = page.getByTestId('lowcode-interactive-value'),
    picker = page.getByLabel('Choose color', { exact: true })
  await picker.focus()
  const previous = await picker.elementHandle()
  if (!previous) throw new Error('Previous color picker unavailable')
  try {
    await value.fill('#123456')
    await value.blur()
    await picker.focus()
    await previous.evaluate((element) => {
      element.value = '#abcdef'
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(value).toHaveValue('#123456')
  } finally {
    await previous.dispose()
  }
  canvas.assertNoErrors()
})

test('new description focus rejects old label and value input after cancel and retained restoration', async ({
  page
}) => {
  const canvas = await prepareExpansionModules(page, 'retained', ['descriptions'])
  await insertExpansionModule(page, 'descriptions')
  const id = await selectedContentNodeId(page),
    editor = page.getByTestId('descriptions-items-editor')
  const row = page.getByTestId('descriptions-item-row').first()
  const label = row.getByRole('textbox', { name: 'Label', exact: true }),
    value = row.getByRole('textbox', { name: 'Value', exact: true })
  for (const boundary of ['cancel', 'retained']) {
    await value.fill('Old draft')
    const oldLabel = await label.elementHandle(),
      oldValue = await value.elementHandle()
    if (!oldLabel || !oldValue) throw new Error('Previous descriptions fields unavailable')
    try {
      if (boundary === 'cancel')
        await editor.getByRole('button', { name: 'Cancel edits', exact: true }).click()
      else {
        await canvas.click(12, 12)
        await selectContentLayer(page, id)
      }
      await label.focus()
      await oldLabel.evaluate((element) => {
        element.value = 'Late label'
        element.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await expect(label).toHaveValue('Name')
      await value.focus()
      await oldValue.evaluate((element) => {
        element.value = 'Late value'
        element.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await expect(value).toHaveValue('Sample project')
      await expect(editor.getByRole('button', { name: 'Apply items', exact: true })).toBeDisabled()
    } finally {
      await oldLabel.dispose()
      await oldValue.dispose()
    }
  }
  canvas.assertNoErrors()
})

test('description pairs apply as one undo and keep invalid or cancelled drafts out of the document', async ({
  page
}) => {
  const canvas = await prepareExpansionModules(page, 'retained', ['descriptions'])
  await insertExpansionModule(page, 'descriptions')
  const editor = page.getByTestId('descriptions-items-editor'),
    rows = page.getByTestId('descriptions-item-row')
  await expect(editor).toBeVisible()
  const before = await selectedExpansionConfig(page)
  const label = rows.first().getByRole('textbox', { name: 'Label', exact: true }),
    value = rows.first().getByRole('textbox', { name: 'Value', exact: true })
  await label.fill('')
  await value.fill('第一行\nSecond line')
  await editor.getByRole('button', { name: 'Apply items', exact: true }).click()
  await expect(editor.getByRole('alert')).toBeVisible()
  await expect(value).toHaveValue('第一行\nSecond line')
  expect(await selectedExpansionConfig(page)).toEqual(before)
  await label.fill('项目')
  await editor.getByRole('button', { name: 'Apply items', exact: true }).click()
  expect((await selectedExpansionConfig(page)).items).toEqual([
    { id: 'name', label: '项目', value: '第一行\nSecond line' },
    ...(before.items as object[]).slice(1)
  ])
  await page.getByTestId('toolbar').getByRole('button').first().focus()
  await canvas.undo()
  expect(await selectedExpansionConfig(page)).toEqual(before)
  await expect(label).toHaveValue('Name')
  await value.fill('Cancelled')
  await editor.getByRole('button', { name: 'Cancel edits', exact: true }).click()
  await expect(value).toHaveValue('Sample project')
  expect(await selectedExpansionConfig(page)).toEqual(before)
  await editor.getByRole('button', { name: 'Add item', exact: true }).click()
  await expect(rows).toHaveCount(7)
  await editor.getByRole('button', { name: 'Apply items', exact: true }).click()
  expect((await selectedExpansionConfig(page)).items).toHaveLength(7)
  await rows.last().getByRole('button', { name: 'Remove item', exact: true }).click()
  await editor.getByRole('button', { name: 'Apply items', exact: true }).click()
  await expect(rows).toHaveCount(6)
  const first = await selectedContentNodeId(page)
  await insertExpansionModule(page, 'descriptions')
  await value.fill('Pending')
  const old = await value.elementHandle(),
    apply = await editor.getByRole('button', { name: 'Apply items', exact: true }).elementHandle()
  if (!old || !apply) throw new Error('Descriptions edit controls unavailable')
  try {
    await selectContentLayer(page, first)
    await old.evaluate((element) => {
      element.dispatchEvent(new FocusEvent('focus'))
      element.value = 'Late'
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await apply.evaluate((element) => element.click())
    await expect(value).toHaveValue('Sample project')
  } finally {
    await old.dispose()
    await apply.dispose()
  }
  await value.fill('Retained pending')
  const retained = await editor
    .getByRole('button', { name: 'Apply items', exact: true })
    .elementHandle()
  if (!retained) throw new Error('Missing retained apply button')
  try {
    await canvas.click(12, 12)
    await expect(page.getByTestId('design-panel-empty')).toBeVisible()
    await retained.evaluate((element) => element.click())
    await selectContentLayer(page, first)
    await expect(value).toHaveValue('Sample project')
  } finally {
    await retained.dispose()
  }
  canvas.assertNoErrors()
})

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: color input paints the authored color and value`, async ({ page }) => {
    const canvas = await prepareInputFields(page, renderer)
    await colorPickerFixture(page)
    await waitForExpansionPaint(canvas, [23, 43, 77])
    await expect(page).toHaveScreenshot(`${renderer}-color-picker.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    canvas.assertNoErrors()
  })

  test(`${renderer}: descriptions paint authored labels and values in both layouts`, async ({
    page
  }) => {
    await prepareInputFonts(page)
    const detailsCanvas = await prepareExpansionModules(page, renderer, ['descriptions'])
    await loadInputFonts(page)
    await insertExpansionModule(page, 'descriptions')
    const rows = page.getByTestId('descriptions-item-row')
    await rows.first().getByRole('textbox', { name: 'Label', exact: true }).fill('项目名称')
    await rows.first().getByRole('textbox', { name: 'Value', exact: true }).fill('设计工作区')
    await page.getByRole('button', { name: 'Apply items', exact: true }).click()
    const layout = expansionField(page, 'layout').getByRole('combobox')
    for (const mode of ['horizontal', 'vertical']) {
      await layout.blur()
      await layout.focus()
      await layout.selectOption(mode)
      await waitForExpansionPaint(detailsCanvas, [23, 43, 77])
      await expect(page).toHaveScreenshot(`${renderer}-descriptions-${mode}.png`, {
        clip: await selectedModuleClip(page),
        animations: 'disabled',
        maxDiffPixelRatio: 0
      })
    }
    detailsCanvas.assertNoErrors()
  })
}
