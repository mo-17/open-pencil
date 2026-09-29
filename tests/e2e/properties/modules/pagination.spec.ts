import { expect, test } from '#tests/e2e/fixtures'
import {
  expansionField,
  insertExpansionModule,
  prepareExpansionModules,
  selectedExpansionConfig,
  selectedModuleClip,
  setExpansionNumber,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'

// Covers application startup, plugin installation, inspector edits and canvas capture.
test.setTimeout(45_000)
test.use({ viewport: { width: 1600, height: 1100 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: pagination canvas follows authored pages and empty totals`, async ({
    page
  }) => {
    const canvas = await prepareExpansionModules(page, renderer, ['pagination'])
    await insertExpansionModule(page, 'pagination')
    await setExpansionNumber(page, 'total', '1000')
    await setExpansionNumber(page, 'initialPage', '50')
    await expect
      .poll(() => selectedExpansionConfig(page))
      .toMatchObject({
        total: 1000,
        initialPage: 50,
        pageSize: 10
      })
    await waitForExpansionPaint(canvas, [23, 43, 77])
    await expect(page).toHaveScreenshot(`${renderer}-pagination-middle.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    await setExpansionNumber(page, 'total', '0')
    await expect
      .poll(() => selectedExpansionConfig(page))
      .toMatchObject({
        total: 0,
        initialPage: 50
      })
    await waitForExpansionPaint(canvas, [23, 43, 77])
    await expect(page).toHaveScreenshot(`${renderer}-pagination-empty.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    await expect.poll(() => selectedExpansionConfig(page)).toMatchObject({ total: 1000 })
    const disabled = expansionField(page, 'disabled').getByRole('checkbox')
    await disabled.check()
    await expect.poll(() => selectedExpansionConfig(page)).toMatchObject({ disabled: true })
    canvas.assertNoErrors()
  })
}
