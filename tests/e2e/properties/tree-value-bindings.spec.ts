import { expect, test } from '#tests/e2e/fixtures'
import {
  expansionField,
  insertExpansionModule,
  prepareExpansionModules,
  selectedModuleClip,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'
import {
  prepareTreeControlFixture,
  selectIndependentTree,
  selectPlainFrame,
  selectTreeControl,
  treeControlState,
  waitForTreeControlPaint
} from '#tests/helpers/plugins/tree-value-bindings'

test.setTimeout(120_000)
test.use({ viewport: { width: 1600, height: 1100 } })

test('Tree panel selects exact page/document types, edits its FORM field name and keeps invalid mode changes visible', async ({
  page
}) => {
  const canvas = await prepareExpansionModules(page, 'retained', ['tree'])
  const formId = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil.getStore()
    editor.updateNode(editor.state.currentPageId, {
      state: [
        { id: 'category', name: 'category', type: 'string', defaultValue: 'design' },
        {
          id: 'selectedCategories',
          name: 'selectedCategories',
          type: 'array',
          defaultValue: ['design']
        },
        {
          id: 'calculatedCategory',
          name: 'calculatedCategory',
          type: 'string',
          defaultValue: 'design',
          computedExpr: '"design"'
        }
      ]
    })
    editor.updateNode(editor.graph.rootId, {
      lowcodeDocumentState: [
        { id: 'docCategory', name: 'docCategory', type: 'string', defaultValue: 'project' },
        { id: 'docCategories', name: 'docCategories', type: 'array', defaultValue: ['project'] }
      ]
    })
    return editor.createShape('FORM', 100, 100, 500, 700, undefined, 'Tree form')
  })
  await insertExpansionModule(page, 'tree')
  const treeId = await page.evaluate((form) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil.getStore(),
      id = [...editor.state.selectedIds][0]
    editor.graph.reparentNode(id, form)
    editor.select([id])
    return id
  }, formId)
  const binding = page.locator('[data-module-binding="value"]')
  await binding.click()
  await expect(page.getByRole('option', { name: /Bind to: category/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /docCategory/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /selectedCategories/ })).toHaveCount(0)
  await expect(page.getByRole('option', { name: /calculatedCategory/ })).toHaveCount(0)
  await page.getByRole('option', { name: /Bind to: category/ }).click()
  const fieldName = page.locator('[data-module-field-name="value"]')
  await fieldName.fill('categories')
  await fieldName.press('Enter')
  expect(
    await page.evaluate((id) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil.getStore().graph.getNode(id)?.interactiveProps?.moduleFieldNames
    }, treeId)
  ).toEqual({ value: 'categories' })
  const selectionMode = expansionField(page, 'selectionMode').getByRole('combobox')
  await selectionMode.click()
  await selectionMode.selectOption('multiple')
  await expect
    .poll(() =>
      page.evaluate((id) => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
        return (
          window.openPencil.getStore().graph.getNode(id)?.interactiveProps?.module as
            | { config?: { selectionMode?: string } }
            | undefined
        )?.config?.selectionMode
      }, treeId)
    )
    .toBe('multiple')
  expect(
    await page.evaluate((id) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil.getStore().graph.getNode(id)?.bindings?.value
    }, treeId)
  ).toEqual({ kind: 'ref', stateId: 'category' })
  await binding.click()
  await expect(page.getByRole('option', { name: /invalid/i })).toBeVisible()
  await expect(page.getByRole('option', { name: /selectedCategories/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /docCategories/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /Bind to: category/ })).toHaveCount(0)
  await page.getByRole('option', { name: /docCategories/ }).click()
  expect(
    await page.evaluate((id) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil.getStore().graph.getNode(id)?.bindings?.value
    }, treeId)
  ).toEqual({ kind: 'docState', docStateName: 'docCategories' })
  const rules = page
    .locator('[data-slot="module-value"][data-mode="validation"]')
    .locator('[data-module-value-field="value"]')
  await rules.getByTestId('lowcode-validation-required').click()
  await expect(rules.getByTestId('lowcode-validation-required')).toBeChecked()
  await page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil.getStore().select([id])
  }, formId)
  await expect(page.getByTestId('lowcode-form-overview')).toBeVisible()
  await expect(page.locator('[data-form-submission-name]')).toContainText('categories')
  canvas.assertNoErrors()
})

for (const renderer of ['retained', 'tiled'] as const)
  for (const presentation of ['tree', 'select'] as const)
    test(`${renderer}: ${presentation} inspector persists Disabled and Read only, restores history and switches owners`, async ({
      page
    }) => {
      const canvas = await prepareExpansionModules(page, renderer, ['tree'])
      await insertExpansionModule(page, 'tree')
      const treeId = await prepareTreeControlFixture(page, presentation),
        bindingPanel = page.locator('[data-slot="module-value"][data-mode="binding"]'),
        readOnly = bindingPanel.getByRole('switch', { name: 'Read only', exact: true }),
        disabled = expansionField(page, 'disabled').getByRole('checkbox')
      await expect(readOnly).not.toBeChecked()
      await expect(disabled).not.toBeChecked()
      await waitForExpansionPaint(canvas)
      const initial = await treeControlState(page, treeId)

      await disabled.click()
      await expect(disabled).toBeChecked()
      await expect
        .poll(() => treeControlState(page, treeId))
        .toMatchObject({
          disabled: true,
          readOnly: false,
          binding: { kind: 'ref', stateId: 'category' }
        })
      await waitForTreeControlPaint(page)
      await expect(page).toHaveScreenshot(`${renderer}-${presentation}-panel-disabled.png`, {
        animations: 'disabled',
        clip: await selectedModuleClip(page)
      })
      await page.getByTestId('toolbar').getByRole('button').first().focus()
      await canvas.undo()
      await expect(disabled).not.toBeChecked()
      await canvas.redo()
      await expect(disabled).toBeChecked()
      await disabled.click()
      await expect(disabled).not.toBeChecked()

      await readOnly.click()
      await expect(readOnly).toBeChecked()
      await expect
        .poll(() => treeControlState(page, treeId))
        .toMatchObject({
          disabled: false,
          readOnly: true,
          binding: { kind: 'ref', stateId: 'category' },
          module: initial.module
        })
      await waitForTreeControlPaint(page)
      await expect(page).toHaveScreenshot(`${renderer}-${presentation}-panel-readonly.png`, {
        animations: 'disabled',
        clip: await selectedModuleClip(page)
      })
      await page.getByTestId('toolbar').getByRole('button').first().focus()
      await canvas.undo()
      await expect(readOnly).not.toBeChecked()
      await canvas.redo()
      await expect(readOnly).toBeChecked()

      const otherId = await selectIndependentTree(page, treeId)
      await expect(readOnly).not.toBeChecked()
      await readOnly.click()
      await expect(readOnly).toBeChecked()
      await expect.poll(() => treeControlState(page, otherId)).toMatchObject({ readOnly: true })
      await readOnly.click()
      await expect(readOnly).not.toBeChecked()
      await expect.poll(() => treeControlState(page, treeId)).toMatchObject({ readOnly: true })
      await selectTreeControl(page, treeId)
      await expect(readOnly).toBeChecked()
      await selectPlainFrame(page)
      await expect(readOnly).toHaveCount(0)
      canvas.assertNoErrors()
    })
