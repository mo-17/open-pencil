import { expect, test } from '#tests/e2e/fixtures'
import {
  prepareExpansionModules,
  insertExpansionModule,
  selectedExpansionConfig,
  selectedModuleClip,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'
import {
  selectedContentNodeId,
  selectContentLayer
} from '#tests/helpers/plugins/content-components'

test.use({ viewport: { width: 1600, height: 1100 } })
test.setTimeout(90_000)
for (const renderer of ['retained', 'tiled'] as const)
  test(`${renderer}: cascader hierarchy edits preserve leaf paths, undo and stale owner protection`, async ({
    page
  }) => {
    const canvas = await prepareExpansionModules(page, renderer, ['cascader'])
    await insertExpansionModule(page, 'cascader')
    const first = await selectedContentNodeId(page)
    const rows = page.getByTestId('tree-item-row')
    const original = await selectedExpansionConfig(page)
    await expect(rows).toHaveCount(6)
    await expect(rows.first().getByTestId('tree-item-selected')).toBeDisabled()
    await rows.nth(1).getByTestId('tree-item-id').fill('cn')
    await rows.nth(2).getByTestId('tree-item-label').fill('厦门')
    await rows.nth(2).getByTestId('tree-item-selected').check()
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await page.getByTestId('tree-apply').click()
    expect((await selectedExpansionConfig(page)).initialPath).toEqual(['asia', 'cn', 'xiamen'])
    await waitForExpansionPaint(canvas, [17, 24, 39])
    await expect(page).toHaveScreenshot(`${renderer}-cascader-path.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await canvas.redo()
    await rows.nth(1).getByTestId('tree-item-remove').click()
    await page.getByTestId('tree-apply').click()
    expect((await selectedExpansionConfig(page)).initialPath).toEqual(['asia', 'xiamen'])
    await rows.nth(1).getByTestId('tree-item-label').fill('Unapplied draft')
    const oldApply = await page.getByTestId('tree-apply').elementHandle()
    if (!oldApply) throw new Error('Missing hierarchy apply')
    await insertExpansionModule(page, 'cascader')
    const second = await selectedContentNodeId(page)
    await rows.nth(2).getByTestId('tree-item-label').fill('Fresh second draft')
    await oldApply.evaluate((element) =>
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    expect((await selectedExpansionConfig(page)).initialPath).toEqual([])
    await expect(rows.nth(2).getByTestId('tree-item-label')).toHaveValue('Fresh second draft')
    await selectContentLayer(page, first)
    await expect(rows.nth(1).getByTestId('tree-item-label')).toHaveValue('厦门')
    await selectContentLayer(page, second)
    await expect(rows.nth(2).getByTestId('tree-item-label')).toHaveValue('Xiamen')
    await oldApply.dispose()
    canvas.assertNoErrors()
  })
