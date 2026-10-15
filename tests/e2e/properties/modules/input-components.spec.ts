import { expect, test } from '#tests/e2e/fixtures'
import {
  expansionField,
  insertExpansionModule,
  prepareExpansionModules,
  selectedExpansionConfig,
  selectedModuleClip,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'
import {
  drawInputSelect,
  loadInputFonts,
  prepareInputFonts,
  removeInputNode
} from '#tests/helpers/plugins/input-components'

test.use({ viewport: { width: 1600, height: 1100 } })
for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: input components paint authored Chinese content through real editor controls`, async ({
    page
  }) => {
    test.setTimeout(180_000)
    await prepareInputFonts(page)
    const canvas = await prepareExpansionModules(page, renderer, ['tree', 'date-range', 'popover'])
    await loadInputFonts(page)
    async function text(field: string, value: string) {
      const input = expansionField(page, field).getByRole('textbox')
      await input.fill(value)
      await input.blur()
    }
    async function snapshot(name: string, textColor?: readonly number[]) {
      await waitForExpansionPaint(canvas, textColor)
      await expect(page).toHaveScreenshot(`${renderer}-${name}.png`, {
        clip: await selectedModuleClip(page),
        animations: 'disabled',
        maxDiffPixelRatio: 0
      })
    }
    await insertExpansionModule(page, 'tree')
    await text('label', '项目目录与分类')
    const rows = page.getByTestId('tree-item-row')
    await rows.first().getByTestId('tree-item-label').fill('工作空间 Workspace')
    await rows.nth(1).getByTestId('tree-item-label').fill('设计规范与组件 Design')
    await rows.nth(2).getByTestId('tree-item-label').fill('开发文档 Development')
    await rows.nth(1).getByTestId('tree-item-selected').check()
    await page.getByTestId('tree-apply').click()
    expect(await selectedExpansionConfig(page)).toMatchObject({ initialSelectedIds: ['design'] })
    await snapshot('tree-selected')
    const presentation = expansionField(page, 'presentation').getByRole('combobox')
    await presentation.focus()
    await presentation.selectOption('select')
    expect(await selectedExpansionConfig(page)).toMatchObject({ presentation: 'select' })
    await snapshot('tree-select-closed')
    await removeInputNode(canvas)

    await insertExpansionModule(page, 'date-range')
    await text('label', '项目起止日期')
    await text('startLabel', '开始日期')
    await text('endLabel', '结束日期')
    await text('initialStart', '2026-09-27')
    await text('initialEnd', '2026-10-03')
    expect(await selectedExpansionConfig(page)).toMatchObject({
      initialStart: '2026-09-27',
      initialEnd: '2026-10-03'
    })
    await snapshot('date-range-filled')
    await removeInputNode(canvas)

    await insertExpansionModule(page, 'popover')
    await text('triggerLabel', '查看详情与说明')
    await snapshot('popover-trigger', [29, 78, 216])
    await removeInputNode(canvas)

    await drawInputSelect(canvas)
    const section = page.getByTestId('inspector-section-lowcode-control')
    await expect(section).toBeVisible()
    const labels = ['设计规范', '组件开发', '测试验收']
    for (const [index, label] of labels.entries()) {
      await section.getByRole('button', { name: 'Add option', exact: true }).click()
      const input = section.getByRole('textbox', {
        name: `Display label ${index + 1}`,
        exact: true
      })
      await input.fill(label)
      await input.press('Enter')
    }
    await section.getByRole('checkbox', { name: 'Select multiple options', exact: true }).check()
    await section.getByRole('checkbox', { name: '设计规范', exact: true }).check()
    await section.getByRole('checkbox', { name: '组件开发', exact: true }).check()
    const value = await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const editor = window.openPencil.getStore()
      return editor.graph.getNode([...editor.state.selectedIds][0])?.interactiveProps
    })
    expect(value?.multiple).toBe(true)
    expect(value?.value).toEqual(['option-1', 'option-2'])
    await snapshot('select-multiple')
    canvas.assertNoErrors()
  })
}
