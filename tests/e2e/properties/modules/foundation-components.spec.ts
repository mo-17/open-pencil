import { expect, test } from '#tests/e2e/fixtures'
import {
  selectedModuleClip,
  expansionField,
  insertExpansionModule,
  prepareExpansionModules,
  selectedExpansionConfig,
  setExpansionNumber,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'

test.use({ viewport: { width: 1600, height: 1100 } })
for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: tooltip and empty-state visual fields edit the saved canvas nodes`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    const canvas = await prepareExpansionModules(page, renderer, ['tooltip', 'empty-state'])
    await insertExpansionModule(page, 'tooltip')
    const trigger = expansionField(page, 'triggerLabel').getByRole('textbox')
    await trigger.fill('How this works')
    await trigger.blur()
    expect(await selectedExpansionConfig(page)).toMatchObject({ triggerLabel: 'How this works' })
    await waitForExpansionPaint(canvas, [29, 78, 216])
    await expect(page).toHaveScreenshot(`${renderer}-tooltip-trigger.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.deleteSelection()
    await insertExpansionModule(page, 'empty-state')
    const title = expansionField(page, 'title').getByRole('textbox')
    await title.fill('No matching results')
    await title.blur()
    const illustration = expansionField(page, 'illustration').getByRole('combobox')
    await illustration.focus()
    await illustration.selectOption('search')
    expect(await selectedExpansionConfig(page)).toMatchObject({ illustration: 'search' })
    await waitForExpansionPaint(canvas, [23, 37, 84])
    await expect(page).toHaveScreenshot(`${renderer}-empty-search.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    await illustration.blur()
    await illustration.focus()
    await illustration.selectOption('none')
    await expect(expansionField(page, 'iconSize')).toHaveCount(0)
    expect(await selectedExpansionConfig(page)).toMatchObject({
      title: 'No matching results',
      illustration: 'none'
    })
    canvas.assertNoErrors()
  })
  test(`${renderer}: skeleton modes preserve line settings and visible labels render`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    const canvas = await prepareExpansionModules(page, renderer, ['skeleton'])
    await insertExpansionModule(page, 'skeleton')
    await expansionField(page, 'showLabel').getByRole('checkbox').check()
    const label = expansionField(page, 'label').getByRole('textbox')
    await label.fill('Loading content')
    await label.blur()
    await setExpansionNumber(page, 'rows', '4')
    await setExpansionNumber(page, 'lastLineWidth', '45')
    await waitForExpansionPaint(canvas, [100, 116, 139])
    await expect(page).toHaveScreenshot(`${renderer}-skeleton-lines.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    const variant = expansionField(page, 'variant').getByRole('combobox')
    await variant.focus()
    await variant.selectOption('circle')
    await expect(expansionField(page, 'rows')).toHaveCount(0)
    await expect(expansionField(page, 'borderRadius')).toHaveCount(0)
    await variant.blur()
    await variant.focus()
    await variant.selectOption('rectangle')
    await expect.poll(() => selectedExpansionConfig(page)).toMatchObject({ variant: 'rectangle' })
    await variant.blur()
    await variant.focus()
    await variant.selectOption('text')
    expect(await selectedExpansionConfig(page)).toMatchObject({
      variant: 'text',
      rows: 4,
      lastLineWidth: 45,
      showLabel: true
    })
    canvas.assertNoErrors()
  })
}
