import { expect, test } from '#tests/e2e/fixtures'
import {
  inputFieldsFixture,
  prepareInputFields,
  savedInputFields
} from '#tests/helpers/lowcode/input-fields'
import {
  selectedModuleClip,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'
import { deferContentCommit, selectContentLayer } from '#tests/helpers/plugins/content-components'

test.use({ viewport: { width: 1600, height: 1100 } })

test('suggestions apply as one edit, cancel invalid drafts and survive undo', async ({ page }) => {
  const canvas = await prepareInputFields(page)
  const { first } = await inputFieldsFixture(page)
  const field = page.locator('[data-property="input-suggestions"]')
  const rows = field.getByRole('textbox')
  await expect(rows).toHaveCount(2)
  await rows.first().fill('福州')
  await field.getByRole('button', { name: 'Add suggestion', exact: true }).click()
  await expect(field.getByRole('alert')).toBeVisible()
  await expect(field.getByRole('button', { name: 'Apply suggestions', exact: true })).toBeDisabled()
  await rows.nth(2).fill('福州')
  await expect(field.getByRole('alert')).toBeVisible()
  await field.getByRole('button', { name: 'Cancel edits', exact: true }).click()
  await expect(rows.first()).toHaveValue('厦门')
  await expect(rows).toHaveCount(2)
  await rows.first().fill('福州')
  await field.getByRole('button', { name: 'Add suggestion', exact: true }).click()
  await rows.nth(2).fill('上海')
  await field.getByRole('button', { name: 'Apply suggestions', exact: true }).click()
  expect((await savedInputFields(page, first)).properties?.suggestions).toEqual([
    '福州',
    '泉州',
    '上海'
  ])
  await page.getByTestId('toolbar').getByRole('button').first().focus()
  await canvas.undo()
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toHaveValue('厦门')
  await canvas.redo()
  await expect(rows).toHaveCount(3)
  await expect(rows.first()).toHaveValue('福州')
  canvas.assertNoErrors()
})

test('input modes filter page and document bindings by the actual value contract', async ({
  page
}) => {
  const canvas = await prepareInputFields(page)
  const ids = await inputFieldsFixture(page)
  const binding = page.getByTestId('lowcode-value-binding-select')
  await expect(binding.locator('option[value="state:string"]')).toHaveCount(1)
  await expect(binding.locator('option[value="doc:documentText"]')).toHaveCount(1)
  await expect(binding.locator('option[value="state:number"]')).toHaveCount(0)
  await expect(binding.locator('option[value="state:array"]')).toHaveCount(0)
  await binding.selectOption('state:string')
  await expect(binding).toHaveValue('state:string')
  await selectContentLayer(page, ids.multiple)
  await expect(binding.locator('option[value="state:array"]')).toHaveCount(1)
  await expect(binding.locator('option[value="doc:documentArray"]')).toHaveCount(1)
  await expect(binding.locator('option[value="state:string"]')).toHaveCount(0)
  await binding.selectOption('doc:documentArray')
  await expect(binding).toHaveValue('doc:documentArray')
  expect((await savedInputFields(page, ids.multiple)).binding).toEqual({
    kind: 'docState',
    docStateName: 'documentArray'
  })
  await selectContentLayer(page, ids.second)
  await expect(binding.locator('option[value="state:number"]')).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Input type', exact: true }).click()
  await page.getByRole('option', { name: 'time', exact: true }).click()
  await expect(binding.locator('option[value="state:number"]')).toHaveCount(0)
  await expect(binding.locator('option[value="state:string"]')).toHaveCount(1)
  canvas.assertNoErrors()
})

for (const renderer of ['retained', 'tiled']) {
  test(`${renderer}: input canvas and time drafts stay consistent across selection and retained deactivation`, async ({
    page
  }) => {
    const canvas = await prepareInputFields(page, renderer)
    const ids = await inputFieldsFixture(page)
    await waitForExpansionPaint(canvas, [23, 43, 77])
    await expect(page).toHaveScreenshot(`${renderer}-autocomplete-input.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    await page.getByRole('combobox', { name: 'Input type', exact: true }).click()
    await page.getByRole('option', { name: 'time', exact: true }).click()
    const input = page.getByTestId('lowcode-interactive-value')
    await input.fill('25:00')
    await input.blur()
    await expect(input).toHaveValue('25:00')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    expect((await savedInputFields(page, ids.first)).properties?.value).toBeUndefined()
    await input.press('Escape')
    await expect(input).toHaveValue('')
    await input.fill('23:15:30')
    await input.blur()
    await page.getByRole('textbox', { name: 'Earliest time', exact: true }).fill('22:00')
    await page.getByRole('textbox', { name: 'Earliest time', exact: true }).blur()
    await page.getByRole('textbox', { name: 'Latest time', exact: true }).fill('04:00')
    await page.getByRole('textbox', { name: 'Latest time', exact: true }).blur()
    await expect(
      page.getByText(
        'The initial time is outside the allowed range; adjust it before submitting.',
        { exact: true }
      )
    ).toHaveCount(0)
    await waitForExpansionPaint(canvas, [23, 43, 77])
    await expect(page).toHaveScreenshot(`${renderer}-time-input.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    await input.fill('12:00')
    const pending = await deferContentCommit(input)
    try {
      await selectContentLayer(page, ids.second)
      await expect(page.getByTestId('lowcode-interactive-value')).toHaveValue('Keep me')
      await pending.deliver()
      await expect(page.getByTestId('lowcode-interactive-value')).toHaveValue('Keep me')
      await selectContentLayer(page, ids.first)
      await expect(input).toHaveValue('23:15:30')
    } finally {
      await pending.dispose()
    }
    await input.fill('11:00')
    const late = await deferContentCommit(input)
    try {
      await canvas.click(12, 12)
      await expect(page.getByTestId('design-panel-empty')).toBeVisible()
      await late.deliver()
      await selectContentLayer(page, ids.first)
      await expect(input).toHaveValue('23:15:30')
    } finally {
      await late.dispose()
    }
    canvas.assertNoErrors()
  })
}
