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
test.setTimeout(120_000)
for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: organization chart items apply atomically, undo and paint real hierarchy`, async ({
    page
  }) => {
    const canvas = await prepareExpansionModules(page, renderer, ['org-chart'])
    await insertExpansionModule(page, 'org-chart')
    const rows = page.getByTestId('org-chart-item-row')
    const original = await selectedExpansionConfig(page)
    await expect(rows).toHaveCount(5)
    await rows.first().getByTestId('org-chart-item-label').fill('产品团队')
    await rows.first().getByTestId('org-chart-item-description').fill('本地可编辑组织')
    await rows.nth(2).getByTestId('org-chart-item-collapsed').check()
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await page.getByTestId('org-chart-apply').click()
    const updated = await selectedExpansionConfig(page)
    expect(updated).toMatchObject({ initialCollapsedIds: ['engineering'] })
    expect(updated.items).toEqual(
      expect.arrayContaining([
        { id: 'root', parentId: '', label: '产品团队', description: '本地可编辑组织' }
      ])
    )
    await waitForExpansionPaint(canvas, [23, 43, 77])
    await expect(page).toHaveScreenshot(`${renderer}-org-chart-collapsed.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    await expect.poll(() => selectedExpansionConfig(page)).toEqual(original)
    await waitForExpansionPaint(canvas, [23, 43, 77])
    await expect(page).toHaveScreenshot(`${renderer}-org-chart-expanded.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    await rows.nth(2).getByTestId('org-chart-item-remove').click()
    await page.getByTestId('org-chart-apply').click()
    expect((await selectedExpansionConfig(page)).items).toEqual(
      expect.arrayContaining([
        { id: 'developer', parentId: 'root', label: 'Developer', description: 'Engineering team' }
      ])
    )
    await rows.first().getByTestId('org-chart-item-label').fill('')
    await page.getByTestId('org-chart-apply').click()
    await expect(page.getByTestId('org-chart-draft-error')).toBeVisible()
    await page.getByTestId('org-chart-cancel').click()
    await expect(rows.first().getByTestId('org-chart-item-label')).toHaveValue('Organization')
    canvas.assertNoErrors()
  })

  test(`${renderer}: organization chart late edits lose authority after selection and retained reactivation`, async ({
    page
  }) => {
    const canvas = await prepareExpansionModules(page, renderer, ['org-chart'])
    await insertExpansionModule(page, 'org-chart')
    const first = await selectedContentNodeId(page),
      original = await selectedExpansionConfig(page)
    await insertExpansionModule(page, 'org-chart')
    const second = await selectedContentNodeId(page)
    const label = page.getByTestId('org-chart-item-label').first()
    await label.fill('Unapplied second')
    const staleInput = await label.elementHandle(),
      staleApply = await page.getByTestId('org-chart-apply').elementHandle()
    if (!staleInput || !staleApply) throw new Error('Missing chart edit controls')
    await selectContentLayer(page, first)
    await label.fill('Fresh first draft')
    await staleInput.evaluate((element) => {
      ;(element as HTMLInputElement).value = 'Late old input'
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await staleApply.evaluate((element) =>
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    await expect(label).toHaveValue('Fresh first draft')
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await selectContentLayer(page, second)
    await expect(label).toHaveValue('Organization')
    await label.fill('Unapplied retained draft')
    const retainedApply = await page.getByTestId('org-chart-apply').elementHandle()
    if (!retainedApply) throw new Error('Missing retained apply')
    await canvas.click(12, 12)
    await expect(page.getByTestId('design-panel-empty')).toBeVisible()
    await selectContentLayer(page, second)
    await label.fill('Fresh restored draft')
    await retainedApply.evaluate((element) =>
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await expect(label).toHaveValue('Fresh restored draft')
    await page.getByTestId('org-chart-apply').click()
    expect((await selectedExpansionConfig(page)).items).toEqual(
      expect.arrayContaining([
        { id: 'root', parentId: '', label: 'Fresh restored draft', description: 'Our team' }
      ])
    )
    await staleInput.dispose()
    await staleApply.dispose()
    await retainedApply.dispose()
    canvas.assertNoErrors()
  })
}
