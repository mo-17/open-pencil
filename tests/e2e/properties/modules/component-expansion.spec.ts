import { expect, test } from '#tests/e2e/fixtures'
import {
  expansionField,
  insertExpansionModule,
  prepareExpansionModules,
  selectedExpansionConfig,
  selectOtherExpansionNode,
  setExpansionNumber,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'

test.use({ viewport: { width: 1600, height: 1100 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: four installed components expose visual fields and painted canvas states`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    const canvas = await prepareExpansionModules(page, renderer, [
      'slider',
      'rating',
      'stepper',
      'breadcrumb'
    ])
    for (const module of ['slider', 'rating', 'stepper', 'breadcrumb'] as const) {
      await insertExpansionModule(page, module)
      if (module === 'slider') {
        await expect(page.getByTestId('module-local-state-hint')).toBeVisible()
        await expansionField(page, 'range').getByRole('checkbox').check()
        await setExpansionNumber(page, 'max', '20')
        await expect(expansionField(page, 'initialValue').getByRole('spinbutton')).toHaveAttribute(
          'aria-valuenow',
          '20'
        )
        await expect(
          expansionField(page, 'initialEndValue').getByRole('spinbutton')
        ).toHaveAttribute('aria-valuenow', '20')
        await setExpansionNumber(page, 'min', '10')
        await setExpansionNumber(page, 'initialValue', '12')
        expect(await selectedExpansionConfig(page)).toMatchObject({
          min: 10,
          max: 20,
          initialValue: 12,
          initialEndValue: 20,
          range: true
        })
      }
      if (module === 'rating') {
        await expect(page.getByTestId('module-local-state-hint')).toBeVisible()
        await expansionField(page, 'allowHalf').getByRole('checkbox').check()
        await setExpansionNumber(page, 'initialValue', '3.5')
        await expansionField(page, 'allowHalf').getByRole('checkbox').uncheck()
        await expect(expansionField(page, 'initialValue').getByRole('spinbutton')).toHaveAttribute(
          'aria-valuenow',
          '4'
        )
        await setExpansionNumber(page, 'max', '2')
        await expect(expansionField(page, 'initialValue').getByRole('spinbutton')).toHaveAttribute(
          'aria-valuenow',
          '2'
        )
        expect(await selectedExpansionConfig(page)).toMatchObject({
          max: 2,
          initialValue: 2,
          allowHalf: false
        })
      }
      if (module === 'stepper' || module === 'breadcrumb') {
        const rows = page.getByTestId('navigation-item-row')
        await expect(rows).toHaveCount(3)
        await rows
          .first()
          .getByTestId('navigation-item-title')
          .fill(module === 'stepper' ? 'Account details' : 'Dashboard')
        await rows.first().getByTestId('navigation-item-title').blur()
        if (module === 'stepper') {
          await rows.nth(2).getByTestId('navigation-current-item').click()
          await expect(rows.nth(2).getByTestId('navigation-current-item')).toHaveAttribute(
            'aria-pressed',
            'true'
          )
        } else {
          await rows.nth(0).getByTestId('navigation-item-href').fill('/dashboard')
          await rows.nth(0).getByTestId('navigation-item-href').blur()
          await expansionField(page, 'separator').getByRole('combobox').selectOption('slash')
        }
      }
      await waitForExpansionPaint(canvas)
      await expect(canvas.canvas).toHaveScreenshot(`${renderer}-${module}-authored.png`, {
        animations: 'disabled'
      })
      await page.getByTestId('toolbar').getByRole('button').first().focus()
      await canvas.deleteSelection()
    }
    canvas.assertNoErrors()
  })

  test(`${renderer}: navigation item edits preserve selection identity and recover invalid or late drafts`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    const canvas = await prepareExpansionModules(page, renderer, ['stepper', 'breadcrumb'])
    await insertExpansionModule(page, 'stepper')
    const rows = page.getByTestId('navigation-item-row')
    await rows.nth(1).getByTestId('navigation-item-title').fill('Keep this step')
    await rows.nth(1).getByTestId('navigation-item-title').blur()
    await rows.nth(1).getByTestId('navigation-move-down').click()
    await expect(rows.nth(2).getByTestId('navigation-item-title')).toHaveValue('Keep this step')
    await expect(rows.nth(2).getByTestId('navigation-current-item')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await rows.first().getByTestId('navigation-remove-item').click()
    await expect(rows.nth(1).getByTestId('navigation-current-item')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await rows.nth(1).getByTestId('navigation-remove-item').click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first().getByTestId('navigation-current-item')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(1).getByTestId('navigation-item-title')).toHaveValue('Keep this step')
    await page.getByTestId('navigation-add-item').click()
    await expect(rows).toHaveCount(3)
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.deleteSelection()
    await insertExpansionModule(page, 'breadcrumb')
    const original = await selectedExpansionConfig(page)
    const href = rows.first().getByTestId('navigation-item-href')
    await href.fill(['javascript', 'alert(1)'].join(':'))
    await href.blur()
    await expect(page.getByTestId('navigation-draft-error')).toBeVisible()
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await page.getByRole('button', { name: 'Restore saved items', exact: true }).click()
    await expect(page.getByTestId('navigation-draft-error')).toHaveCount(0)
    await expect(href).toHaveValue('/')
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.duplicate()
    const title = rows.first().getByTestId('navigation-item-title')
    const detached = await title.elementHandle()
    if (!detached) throw new Error('Title input unavailable')
    await title.fill('Uncommitted title')
    const savedOther = await selectOtherExpansionNode(page, 'breadcrumb')
    await detached.evaluate((element) => {
      element.dispatchEvent(new Event('change', { bubbles: true }))
      element.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    })
    await expect(rows.first().getByTestId('navigation-item-title')).toHaveValue('Home')
    expect(JSON.stringify(await selectedExpansionConfig(page))).toBe(savedOther)
    await waitForExpansionPaint(canvas)
    canvas.assertNoErrors()
  })

  test(`${renderer}: switching value controls discards a pending numeric draft before old blur`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    const canvas = await prepareExpansionModules(page, renderer, ['slider', 'rating'])
    for (const module of ['slider', 'rating'] as const) {
      await insertExpansionModule(page, module)
      await page.getByTestId('toolbar').getByRole('button').first().focus()
      await canvas.duplicate()
      const savedDraftOwner = await selectedExpansionConfig(page)
      const input = expansionField(page, 'initialValue').getByRole('spinbutton')
      await input.click()
      const detached = await input.elementHandle()
      if (!detached) throw new Error('Numeric input unavailable')
      await input.fill(module === 'slider' ? '82' : '4')
      const savedOther = await selectOtherExpansionNode(page, module)
      await detached.evaluate((element) => {
        element.dispatchEvent(new Event('change', { bubbles: true }))
        element.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      })
      expect(JSON.stringify(await selectedExpansionConfig(page))).toBe(savedOther)
      await expect(expansionField(page, 'initialValue').getByRole('spinbutton')).toHaveAttribute(
        'aria-valuenow',
        String(savedDraftOwner.initialValue)
      )
      await selectOtherExpansionNode(page, module)
      expect(await selectedExpansionConfig(page)).toEqual(savedDraftOwner)
      await expect(expansionField(page, 'initialValue').getByRole('spinbutton')).toHaveAttribute(
        'aria-valuenow',
        String(savedDraftOwner.initialValue)
      )
      const stale = expansionField(page, 'initialValue').getByRole('spinbutton')
      await stale.click()
      const staleElement = await stale.elementHandle()
      if (!staleElement) throw new Error('Numeric draft unavailable')
      await stale.fill(module === 'slider' ? '35' : '4')
      const updatedValue = module === 'slider' ? 60 : 2
      await page.evaluate(async (value) => {
        const { readModuleInstance } = await import('/packages/scene-graph/src/module.ts')

        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

        const editor = window.openPencil.getStore()
        const node = editor.graph.getNode([...editor.state.selectedIds][0])
        const stored = readModuleInstance(node?.interactiveProps?.module)
        if (!node || !stored) throw new Error('Module unavailable')
        editor.graph.updateNode(node.id, {
          interactiveProps: {
            ...node.interactiveProps,
            module: { ...stored, config: { ...stored.config, initialValue: value } }
          }
        })
      }, updatedValue)
      await staleElement.evaluate((element) => {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        element.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      })
      expect((await selectedExpansionConfig(page)).initialValue).toBe(updatedValue)
      await expect(expansionField(page, 'initialValue').getByRole('spinbutton')).toHaveAttribute(
        'aria-valuenow',
        String(updatedValue)
      )
      expect(
        await page.evaluate(() => {
          if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
          return window.openPencil.getStore().state.numberFieldFocused
        })
      ).toBe(false)
    }
    canvas.assertNoErrors()
  })
}
