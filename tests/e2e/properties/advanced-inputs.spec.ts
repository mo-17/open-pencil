import { expect, test } from '#tests/e2e/fixtures'
import {
  advancedInputsFixture,
  chooseAdvancedInputProperty
} from '#tests/helpers/lowcode/advanced-inputs'
import { prepareInputFields, savedInputFields } from '#tests/helpers/lowcode/input-fields'
import {
  selectedModuleClip,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'
import { deferContentCommit, selectContentLayer } from '#tests/helpers/plugins/content-components'

test.use({ viewport: { width: 1600, height: 1100 } })

test('date-time drafts reject invalid dates and inverted bounds while preserving string bindings and edit ownership', async ({
  page
}) => {
  const canvas = await prepareInputFields(page)
  const ids = await advancedInputsFixture(page)
  const input = page.getByTestId('lowcode-interactive-value')
  await input.fill('2026-02-30T09:30')
  await input.blur()
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(input).toHaveValue('2026-02-30T09:30')
  expect((await savedInputFields(page, ids.dateTime)).properties?.value).toBe('2026-09-28T09:30')
  await input.press('Escape')
  await expect(input).toHaveValue('2026-09-28T09:30')
  const maximum = page.getByRole('textbox', { name: 'Latest date and time', exact: true })
  await maximum.fill('2025-12-31T23:59')
  await maximum.blur()
  await expect(maximum).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('alert')).toContainText(
    'The earliest date and time must not be later than the latest.'
  )
  expect((await savedInputFields(page, ids.dateTime)).properties?.max).toBe('2026-12-31T23:59')
  await maximum.press('Escape')
  await input.fill('2026-09-28T11:30')
  const pending = await deferContentCommit(input)
  try {
    await selectContentLayer(page, ids.number)
    await pending.deliver()
    await expect(page.getByTestId('lowcode-interactive-value')).toHaveValue('2.5')
    await selectContentLayer(page, ids.dateTime)
    await expect(input).toHaveValue('2026-09-28T09:30')
  } finally {
    await pending.dispose()
  }
  await input.fill('2026-09-28T12:30')
  const late = await deferContentCommit(input)
  try {
    await canvas.click(12, 12)
    await expect(page.getByTestId('design-panel-empty')).toBeVisible()
    await late.deliver()
    await selectContentLayer(page, ids.dateTime)
    await expect(input).toHaveValue('2026-09-28T09:30')
  } finally {
    await late.dispose()
  }
  const binding = page.getByTestId('lowcode-value-binding-select')
  await expect(binding.locator('option[value="state:quantity-number"]')).toHaveCount(0)
  await binding.selectOption('state:local-date-time')
  await expect(binding).toHaveValue('state:local-date-time')
  expect((await savedInputFields(page, ids.dateTime)).binding).toEqual({
    kind: 'ref',
    stateId: 'local-date-time'
  })
  canvas.assertNoErrors()
})

test('number stepper has explicit default and hidden states, undoable placement and compatible password editing', async ({
  page
}) => {
  const canvas = await prepareInputFields(page)
  const ids = await advancedInputsFixture(page)
  await selectContentLayer(page, ids.number)
  await chooseAdvancedInputProperty(page, 'Number stepper', 'Hidden')
  expect((await savedInputFields(page, ids.number)).properties?.showStepper).toBe(false)
  await expect(page.getByRole('combobox', { name: 'Stepper position', exact: true })).toHaveCount(0)
  await chooseAdvancedInputProperty(page, 'Number stepper', 'Browser default')
  expect((await savedInputFields(page, ids.number)).properties?.showStepper).toBeUndefined()
  await chooseAdvancedInputProperty(page, 'Number stepper', 'Custom buttons')
  await chooseAdvancedInputProperty(page, 'Stepper position', 'At the end')
  expect((await savedInputFields(page, ids.number)).properties?.stepperPlacement).toBe('end')
  await page.getByTestId('toolbar').getByRole('button').first().focus()
  await canvas.undo()
  await expect(page.getByRole('combobox', { name: 'Stepper position', exact: true })).toContainText(
    'On both sides'
  )
  await canvas.redo()
  await expect(page.getByRole('combobox', { name: 'Stepper position', exact: true })).toContainText(
    'At the end'
  )
  await chooseAdvancedInputProperty(page, 'Input type', 'password')
  const props = (await savedInputFields(page, ids.number)).properties
  expect(props?.showStepper).toBeUndefined()
  expect(props?.stepperPlacement).toBeUndefined()
  expect(props?.min).toBeUndefined()
  await page.getByTestId('lowcode-interactive-showPasswordToggle').click()
  expect((await savedInputFields(page, ids.number)).properties?.showPasswordToggle).toBe(true)
  const password = page.getByTestId('lowcode-interactive-value')
  await expect(password).toHaveAttribute('type', 'password')
  await password.fill('example-only')
  await password.blur()
  await chooseAdvancedInputProperty(page, 'Input type', 'text')
  await expect(page.getByTestId('lowcode-interactive-value')).toHaveAttribute('type', 'text')
  expect((await savedInputFields(page, ids.number)).properties?.showPasswordToggle).toBeUndefined()
  canvas.assertNoErrors()
})

for (const renderer of ['retained', 'tiled']) {
  test(`${renderer}: advanced input canvas shows configured date-time, numeric buttons and an empty password affordance`, async ({
    page
  }) => {
    const canvas = await prepareInputFields(page, renderer)
    const ids = await advancedInputsFixture(page)
    for (const [name, id] of Object.entries(ids)) {
      await selectContentLayer(page, id)
      await waitForExpansionPaint(canvas, [23, 43, 77])
      await expect(page).toHaveScreenshot(`${renderer}-${name}-input.png`, {
        clip: await selectedModuleClip(page),
        animations: 'disabled',
        maxDiffPixelRatio: 0
      })
    }
    canvas.assertNoErrors()
  })
}
