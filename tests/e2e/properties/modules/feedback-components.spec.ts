import { expect, test } from '#tests/e2e/fixtures'
import {
  expansionField,
  insertExpansionModule,
  prepareExpansionModules,
  selectedExpansionConfig,
  setExpansionNumber,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'

test.use({ viewport: { width: 1600, height: 1100 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: feedback components expose meaningful visual fields and canvas states`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    const canvas = await prepareExpansionModules(page, renderer, ['alert', 'progress', 'chip'])
    await insertExpansionModule(page, 'alert')
    await expansionField(page, 'title').getByRole('textbox').fill('Helpful message')
    await expansionField(page, 'title').getByRole('textbox').blur()
    await expansionField(page, 'tone').getByRole('combobox').focus()
    await expansionField(page, 'tone').getByRole('combobox').selectOption('success')
    await expansionField(page, 'closable').getByRole('checkbox').uncheck()
    await expect(expansionField(page, 'closeLabel')).toHaveCount(0)
    await expansionField(page, 'closable').getByRole('checkbox').check()
    await expect(expansionField(page, 'closeLabel').getByRole('textbox')).toHaveValue(
      'Dismiss message'
    )
    expect(await selectedExpansionConfig(page)).toMatchObject({
      tone: 'success',
      title: 'Helpful message',
      closable: true
    })
    await waitForExpansionPaint(canvas, [22, 101, 52])
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-alert-authored.png`, {
      animations: 'disabled'
    })
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.deleteSelection()

    await insertExpansionModule(page, 'progress')
    await expect(page.getByTestId('module-feedback-hint')).toContainText('no live task connection')
    await expect(expansionField(page, 'diameter')).toHaveCount(0)
    await setExpansionNumber(page, 'value', '72.5')
    await waitForExpansionPaint(canvas)
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-progress-linear.png`, {
      animations: 'disabled'
    })
    await expansionField(page, 'variant').getByRole('combobox').focus()
    await expansionField(page, 'variant').getByRole('combobox').selectOption('circular')
    await setExpansionNumber(page, 'diameter', '120')
    await expansionField(page, 'indeterminate').getByRole('checkbox').check()
    await expect(expansionField(page, 'value')).toHaveCount(0)
    await expect(expansionField(page, 'showValue')).toHaveCount(0)
    await expect(expansionField(page, 'pendingLabel').getByRole('textbox')).toHaveValue(
      'In progress'
    )
    await waitForExpansionPaint(canvas)
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-progress-pending.png`, {
      animations: 'disabled'
    })
    await expansionField(page, 'indeterminate').getByRole('checkbox').uncheck()
    expect(await selectedExpansionConfig(page)).toMatchObject({
      value: 72.5,
      variant: 'circular',
      indeterminate: false
    })
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.deleteSelection()

    await insertExpansionModule(page, 'chip')
    await expect(expansionField(page, 'initialSelected')).toHaveCount(0)
    await expect(expansionField(page, 'deleteLabel')).toHaveCount(0)
    await expansionField(page, 'label').getByRole('textbox').fill('Review ready')
    await expansionField(page, 'label').getByRole('textbox').blur()
    await expansionField(page, 'selectable').getByRole('checkbox').check()
    await expansionField(page, 'initialSelected').getByRole('checkbox').check()
    await expansionField(page, 'deletable').getByRole('checkbox').check()
    await expect(expansionField(page, 'deleteLabel')).toBeVisible()
    expect(await selectedExpansionConfig(page)).toMatchObject({
      label: 'Review ready',
      selectable: true,
      initialSelected: true,
      deletable: true
    })
    await waitForExpansionPaint(canvas, [37, 99, 235])
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-chip-authored.png`, {
      animations: 'disabled'
    })
    canvas.assertNoErrors()
  })
}
