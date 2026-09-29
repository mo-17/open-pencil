import { expect, test } from '#tests/e2e/fixtures'
import {
  insertExpansionModule,
  prepareExpansionModules
} from '#tests/helpers/plugins/component-expansion'
import { deferContentCommit, selectContentLayer } from '#tests/helpers/plugins/content-components'

// Covers application startup, plugin installation, inspector edits and canvas capture.
test.setTimeout(45_000)
test.use({ viewport: { width: 1600, height: 1100 } })

test('pagination bindings reject read-only page state and stale expression edits', async ({
  page
}) => {
  const canvas = await prepareExpansionModules(page, 'retained', ['pagination'])
  await insertExpansionModule(page, 'pagination')
  const ids = await page.evaluate(() => {
    const editor = window.openPencil.getStore()
    const first = [...editor.state.selectedIds][0]
    const module = editor.graph.getNode(first)?.interactiveProps?.module
    if (!module) throw new Error('Pagination module unavailable')
    editor.updateNode(editor.state.currentPageId, {
      state: [
        { id: 'page-number', name: 'pageNumber', type: 'number', defaultValue: 1 },
        {
          id: 'computed-count',
          name: 'count',
          type: 'number',
          defaultValue: 20,
          computedExpr: '10 + 10'
        },
        { id: 'text-count', name: 'textCount', type: 'string', defaultValue: '20' }
      ]
    })
    const second = editor.createShape('FRAME', 600, 200, 440, 48)
    editor.updateNode(second, {
      name: 'Second pagination',
      interactiveProps: { module: structuredClone(module) }
    })
    editor.select([first])
    return { first, second }
  })
  const binding = (key: string) => page.locator(`[data-pagination-binding="${key}"]`)
  const expression = page.locator('[data-pagination-expression="total"]')
  const saved = (id: string) =>
    page.evaluate((nodeId) => window.openPencil.getStore().graph.getNode(nodeId)?.bindings, id)

  await expect(binding('currentPage').locator('option[value="state:computed-count"]')).toHaveCount(
    0
  )
  await expect(binding('currentPage').locator('option[value="state:text-count"]')).toHaveCount(0)
  await expect(binding('total').locator('option[value="state:computed-count"]')).toHaveCount(1)
  // selectOption dispatches change directly; establish the same focus session as a user.
  await binding('currentPage').focus()
  await binding('currentPage').selectOption('state:page-number')
  expect((await saved(ids.first))?.currentPage).toEqual({ kind: 'ref', stateId: 'page-number' })
  await page.getByTestId('toolbar').getByRole('button').first().focus()
  await canvas.undo()
  await expect(binding('currentPage')).toHaveValue('')

  await binding('total').focus()
  await binding('total').selectOption('expression')
  await expression.fill('count + 2')
  await expression.press('Enter')
  expect((await saved(ids.first))?.total).toEqual({ kind: 'expr', expr: 'count + 2' })
  await expression.fill('count +')
  await expression.press('Enter')
  await expect(expression).toHaveAttribute('aria-invalid', 'true')
  expect((await saved(ids.first))?.total).toEqual({ kind: 'expr', expr: 'count + 2' })
  await expression.press('Escape')
  await expect(expression).toHaveValue('count + 2')

  await expression.fill('count + 99')
  const late = await deferContentCommit(expression)
  try {
    await selectContentLayer(page, ids.second)
    await late.deliver()
    expect((await saved(ids.second))?.total).toBeUndefined()
    await selectContentLayer(page, ids.first)
    await expect(expression).toHaveValue('count + 2')
  } finally {
    await late.dispose()
  }

  await expression.fill('count + 77')
  const retained = await deferContentCommit(expression)
  try {
    await canvas.click(12, 12)
    await expect(page.getByTestId('design-panel-empty')).toBeVisible()
    await selectContentLayer(page, ids.first)
    await expression.focus()
    await retained.deliver()
    await expect(expression).toHaveValue('count + 2')
    expect((await saved(ids.first))?.total).toEqual({ kind: 'expr', expr: 'count + 2' })
  } finally {
    await retained.dispose()
  }
  canvas.assertNoErrors()
})
