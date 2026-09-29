import { expect, test } from '#tests/e2e/fixtures'
import {
  expansionField,
  insertExpansionModule,
  prepareExpansionModules
} from '#tests/helpers/plugins/component-expansion'
import { deferContentCommit, selectContentLayer } from '#tests/helpers/plugins/content-components'

test.setTimeout(90_000)
test.use({ viewport: { width: 1600, height: 1100 } })

for (const renderer of ['retained', 'tiled'] as const)
  test(`${renderer}: module bindings filter writable types, keep endpoint rules and reject stale edits`, async ({
    page
  }) => {
    const canvas = await prepareExpansionModules(page, renderer, [
      'slider',
      'rating',
      'date-range',
      'cascader'
    ])
    const form = await page.evaluate(() => {
      const editor = window.openPencil.getStore()
      editor.updateNode(editor.state.currentPageId, {
        state: [
          { id: 'amount', name: 'amount', type: 'number', defaultValue: 20 },
          {
            id: 'calculated',
            name: 'calculated',
            type: 'number',
            defaultValue: 30,
            computedExpr: '10 + 20'
          },
          { id: 'start-date', name: 'startDate', type: 'string', defaultValue: '2026-09-01' },
          { id: 'end-date', name: 'endDate', type: 'string', defaultValue: '2026-09-05' },
          { id: 'path', name: 'locationPath', type: 'array', defaultValue: [] }
        ]
      })
      editor.updateNode(editor.graph.rootId, {
        lowcodeDocumentState: [
          { id: 'doc-number', name: 'docNumber', type: 'number', defaultValue: 80 }
        ]
      })
      return editor.createShape('FORM', 100, 100, 500, 700, undefined, 'Bound module form')
    })
    const ids: string[] = []
    const saved = (id: string) =>
      page.evaluate((nodeId) => {
        const node = window.openPencil.getStore().graph.getNode(nodeId)
        return { bindings: node?.bindings, props: node?.interactiveProps }
      }, id)
    for (const module of ['slider', 'rating', 'date-range', 'cascader'] as const) {
      await insertExpansionModule(page, module)
      const id = await page.evaluate((formId) => {
        const editor = window.openPencil.getStore(),
          id = [...editor.state.selectedIds][0]
        editor.graph.reparentNode(id, formId)
        editor.select([id])
        return id
      }, form)
      ids.push(id)
      if (module === 'slider') await expansionField(page, 'range').getByRole('checkbox').check()
      const binding = page.locator('[data-module-binding="value"]')
      await binding.click()
      await expect(page.getByRole('option', { name: /calculated/ })).toHaveCount(0)
      const targets = {
        slider: 'amount',
        rating: 'amount',
        'date-range': 'startDate',
        cascader: 'locationPath'
      }
      const target = targets[module]
      if (module === 'slider' || module === 'rating')
        await expect(page.getByRole('option', { name: /startDate/ })).toHaveCount(0)
      await page.getByRole('option', { name: new RegExp(target), exact: false }).click()
      expect((await saved(id)).bindings?.value?.kind).toBe('ref')
      if (module === 'slider' || module === 'date-range') {
        await page.locator('[data-module-binding="endValue"]').click()
        await page
          .getByRole('option', { name: module === 'slider' ? /docNumber/ : /endDate/ })
          .click()
        expect((await saved(id)).bindings?.endValue?.kind).toBe(
          module === 'slider' ? 'docState' : 'ref'
        )
        const endRules = page
          .getByTestId('module-value-validation')
          .locator('[data-module-value-field="endValue"]')
        await endRules.getByTestId('lowcode-validation-required').click()
        canvas.assertNoErrors()
        await expect(endRules.getByTestId('lowcode-validation-required')).toBeChecked()
        expect((await saved(id)).props?.endValidation).toEqual({ required: true })
      }
      const rules = page
        .getByTestId('module-value-validation')
        .locator('[data-module-value-field="value"]')
      await rules.getByTestId('lowcode-validation-required').click()
      await expect(rules.getByTestId('lowcode-validation-required')).toBeChecked()
      expect((await saved(id)).props?.validation).toEqual({ required: true })
      const input = rules.getByTestId('lowcode-validation-message-required')
      await input.fill('Please choose a value')
      await input.press('Enter')
      expect((await saved(id)).props?.validation).toMatchObject({
        messages: { required: 'Please choose a value' }
      })
      await page.getByTestId('toolbar').getByRole('button').first().focus()
      await canvas.undo()
      expect((await saved(id)).props?.validation).toEqual({ required: true })
      await binding.click()
      await page.getByRole('option', { name: 'Uncontrolled', exact: true }).click()
      expect((await saved(id)).bindings?.value).toBeUndefined()
    }
    const disclosure = page
      .locator(`[data-node-id="${form}"]`)
      .getByRole('button', { name: 'Bound module form', exact: true })
    await disclosure.click()
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    await selectContentLayer(page, ids[0])
    const field = page
      .getByTestId('module-value-validation')
      .locator('[data-module-value-field="value"]')
      .getByTestId('lowcode-validation-message-required')
    await field.fill('Stale selection draft')
    const late = await deferContentCommit(field)
    try {
      await selectContentLayer(page, ids[1])
      await late.deliver()
      expect((await saved(ids[1])).props?.validation).toEqual({ required: true })
    } finally {
      await late.dispose()
    }
    await selectContentLayer(page, ids[0])
    await field.fill('Stale retained draft')
    const retained = await deferContentCommit(field)
    try {
      await canvas.click(12, 12)
      await expect(page.getByTestId('design-panel-empty')).toBeVisible()
      await selectContentLayer(page, ids[0])
      await field.focus()
      await retained.deliver()
      expect((await saved(ids[0])).props?.validation).toEqual({ required: true })
      await expect(field).toHaveValue('')
    } finally {
      await retained.dispose()
    }
    await selectContentLayer(page, form)
    await expect(page.getByTestId('form-overview-bindings')).toContainText('/6')
    canvas.assertNoErrors()
  })
