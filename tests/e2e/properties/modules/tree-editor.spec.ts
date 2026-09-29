import { expect, test } from '#tests/e2e/fixtures'
import {
  prepareExpansionModules,
  insertExpansionModule,
  selectedExpansionConfig
} from '#tests/helpers/plugins/component-expansion'
import {
  selectedContentNodeId,
  selectContentLayer
} from '#tests/helpers/plugins/content-components'
test.use({ viewport: { width: 1600, height: 1100 } })
for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: Tree visual item edits validate hierarchy and apply as one undoable change`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    const canvas = await prepareExpansionModules(page, renderer, ['tree'])
    await insertExpansionModule(page, 'tree')
    const rows = page.getByTestId('tree-item-row'),
      original = await selectedExpansionConfig(page)
    await expect(rows).toHaveCount(4)
    await rows.first().getByTestId('tree-item-id').fill('workspace')
    await rows.first().getByTestId('tree-item-label').fill('项目目录')
    await rows.nth(1).getByTestId('tree-item-label').fill('中文设计规范')
    await rows.nth(1).getByTestId('tree-item-selected').check()
    await page.getByTestId('tree-apply').click()
    const updated = await selectedExpansionConfig(page)
    expect(updated).toMatchObject({
      initialSelectedIds: ['design'],
      initialExpandedIds: ['workspace']
    })
    expect(updated.items).toEqual([
      { id: 'workspace', label: '项目目录', parentId: '', disabled: false },
      { id: 'design', label: '中文设计规范', parentId: 'workspace', disabled: false },
      { id: 'development', label: 'Development', parentId: 'workspace', disabled: false },
      { id: 'archive', label: 'Archive', parentId: '', disabled: true }
    ])
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await canvas.redo()
    expect(await selectedExpansionConfig(page)).toEqual(updated)
    await rows.nth(1).getByTestId('tree-item-id').fill('workspace')
    await page.getByTestId('tree-apply').click()
    await expect(page.getByTestId('tree-draft-error')).toBeVisible()
    expect(await selectedExpansionConfig(page)).toEqual(updated)
    await page.getByTestId('tree-restore').click()
    await expect(page.getByTestId('tree-draft-error')).toHaveCount(0)
    await rows.nth(1).getByTestId('tree-item-parent').click()
    await page.getByRole('option', { name: 'Root level', exact: true }).click()
    await page.getByTestId('tree-apply').click()
    expect((await selectedExpansionConfig(page)).items).toContainEqual({
      id: 'design',
      label: '中文设计规范',
      parentId: '',
      disabled: false
    })
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    expect(await selectedExpansionConfig(page)).toEqual(updated)
    await rows.first().getByTestId('tree-item-disabled').check()
    await page.getByTestId('tree-apply').click()
    expect(await selectedExpansionConfig(page)).toMatchObject({ initialSelectedIds: [] })
    await expect(rows.nth(1).getByTestId('tree-item-selected')).toBeDisabled()
    canvas.assertNoErrors()
  })
  test(`${renderer}: Tree drafts expire across owner switches and retained hiding before old DOM actions`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    const canvas = await prepareExpansionModules(page, renderer, ['tree'])
    await insertExpansionModule(page, 'tree')
    const first = await selectedContentNodeId(page),
      original = await selectedExpansionConfig(page)
    await insertExpansionModule(page, 'tree')
    const second = await selectedContentNodeId(page)
    const rows = page.getByTestId('tree-item-row')
    await rows.first().getByTestId('tree-item-label').fill('Pending second')
    const stale = await page.getByTestId('tree-apply').elementHandle()
    if (!stale) throw new Error('Missing apply button')
    await selectContentLayer(page, first)
    await stale.evaluate((element) =>
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    await expect(rows.first().getByTestId('tree-item-label')).toHaveValue('Project')
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await selectContentLayer(page, second)
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await rows.first().getByTestId('tree-item-label').fill('Pending retained')
    const hidden = await page.getByTestId('tree-apply').elementHandle()
    if (!hidden) throw new Error('Missing retained apply button')
    await canvas.click(12, 12)
    await expect(page.getByTestId('design-panel-empty')).toBeVisible()
    await hidden.evaluate((element) =>
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    await selectContentLayer(page, second)
    await expect(rows.first().getByTestId('tree-item-label')).toHaveValue('Project')
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await rows.first().getByTestId('tree-item-label').fill('Fresh after restore')
    await page.getByTestId('tree-apply').click()
    expect(await selectedExpansionConfig(page)).not.toEqual(original)
    await stale.dispose()
    await hidden.dispose()
    canvas.assertNoErrors()
  })
}
