import { expect, test } from '#tests/e2e/fixtures'
import {
  expansionField,
  insertExpansionModule,
  prepareExpansionModules,
  selectedModuleClip,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'
import { prepareInputFonts, loadInputFonts } from '#tests/helpers/plugins/input-components'
import { drawPopoverContentRectangle } from '#tests/helpers/plugins/popover'

test.use({ viewport: { width: 1600, height: 1000 } })
for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: Popover creates and edits its own content through the toolbar and returns to the inert trigger`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    await prepareInputFonts(page)
    const canvas = await prepareExpansionModules(page, renderer, ['popover'])
    await loadInputFonts(page)
    await insertExpansionModule(page, 'popover')
    const trigger = expansionField(page, 'triggerLabel').getByRole('textbox')
    await trigger.fill('查看项目详情')
    await trigger.blur()
    const bodyText = page.getByTestId('multiline-module-text-source')
    await bodyText.fill('这是可以自由编辑的浮层内容。\n支持中文和 English。')
    await bodyText.blur()
    await expect(page.getByTestId('modal-edit-content')).toBeDisabled()
    await page.getByTestId('modal-create-content').click()
    const banner = page.getByTestId('content-edit-banner')
    await expect(banner).toContainText('Editing popover content')
    await expect(banner).toContainText('Popover content')
    await waitForExpansionPaint(canvas, [31, 41, 55])
    await expect(page).toHaveScreenshot(`${renderer}-popover-content.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    await drawPopoverContentRectangle(canvas)
    await expect(page.getByTestId('layers-item').filter({ hasText: 'Rectangle' })).toBeVisible()
    await page.getByTestId('modal-finish-content').click()
    await expect(banner).toHaveCount(0)
    await expect(trigger).toHaveValue('查看项目详情')
    await expect(page.getByTestId('modal-edit-content')).toBeEnabled()
    await expect(
      page.getByTestId('module-content-child-select').getByRole('combobox')
    ).toContainText('Popover content')
    await waitForExpansionPaint(canvas, [29, 78, 216])
    await expect(page).toHaveScreenshot(`${renderer}-popover-trigger.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    await page.getByTestId('modal-edit-content').click()
    await expect(banner).toBeVisible()
    await expect(page.getByTestId('layers-item').filter({ hasText: 'Rectangle' })).toBeVisible()
    await page.getByTestId('modal-finish-content').click()
    await page.getByTestId('modal-create-content').click()
    await expect(banner).toContainText('Popover content 2')
    await page.getByTestId('modal-finish-content').click()
    const mapping = page.getByTestId('module-content-child-select').getByRole('combobox')
    await expect(mapping).toContainText('Popover content 2')
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    await expect(mapping).toContainText('Popover content')
    await expect(mapping).not.toContainText('Popover content 2')
    await canvas.redo()
    await expect(mapping).toContainText('Popover content 2')
    canvas.assertNoErrors()
  })
}
