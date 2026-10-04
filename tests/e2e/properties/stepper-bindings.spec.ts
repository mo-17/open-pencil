import { expect, test } from '#tests/e2e/fixtures'
import {
  insertExpansionModule,
  prepareExpansionModules,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'
import {
  makeStepperDefaultInvalid,
  prepareStepperStates
} from '#tests/helpers/plugins/stepper-bindings'

test.setTimeout(120_000)
test.use({ viewport: { width: 1600, height: 1100 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: Stepper inspector binds mutable number state, preserves history and paints defaults`, async ({
    page
  }) => {
    const canvas = await prepareExpansionModules(page, renderer, ['stepper'])
    await prepareStepperStates(page)
    await insertExpansionModule(page, 'stepper')
    const binding = page.getByRole('combobox', { name: 'Current step (from 0)', exact: true })
    await expect(binding).toContainText('Configured step')
    await binding.click()
    await expect(page.getByRole('option', { name: /computed/ })).toHaveCount(0)
    await expect(page.getByRole('option', { name: /text/ })).toHaveCount(0)
    await page.getByRole('option', { name: 'Bind to: progress', exact: true }).click()
    await expect(binding).toContainText('Bind to: progress')
    await waitForExpansionPaint(canvas)
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-stepper-page-default.png`, {
      animations: 'disabled'
    })
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    await expect(binding).toContainText('Configured step')
    await canvas.redo()
    await expect(binding).toContainText('Bind to: progress')
    await binding.click()
    await page.getByRole('option', { name: /docProgress/, exact: false }).click()
    await expect(binding).toContainText('docProgress')
    await waitForExpansionPaint(canvas)
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-stepper-doc-default.png`, {
      animations: 'disabled'
    })
    await makeStepperDefaultInvalid(page)
    await waitForExpansionPaint(canvas, [220, 38, 38])
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-stepper-invalid.png`, {
      animations: 'disabled'
    })
    canvas.assertNoErrors()
  })
}
