import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import {
  expansionField,
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

/** Authored child fixture; all subsequent configuration, remapping and selection use editor UI. */
async function addEditableTargets(page: Page) {
  return page.evaluate(async () => {
    const editor = window.openPencil.getStore(),
      host = [...editor.state.selectedIds][0]
    editor.updateNodeWithUndo(host, { height: 310 })
    const children = ['First card', 'Second card', 'Third card'].map((name, index) => {
      const node = editor.graph.createNode('FRAME', host, {
        name,
        x: 12,
        y: 60 + index * 80,
        width: 296,
        height: 64,
        cornerRadius: 8,
        fills: [
          { type: 'SOLID', color: { r: 0.94, g: 0.96, b: 0.99, a: 1 }, opacity: 1, visible: true }
        ]
      })
      editor.graph.createNode('TEXT', node.id, {
        name: `${name} text`,
        text: name,
        x: 12,
        y: 16,
        width: 272,
        height: 28,
        fontFamily: 'Inter',
        fontSize: 16,
        fills: [
          {
            type: 'SOLID',
            color: { r: 23 / 255, g: 43 / 255, b: 77 / 255, a: 1 },
            opacity: 1,
            visible: true
          }
        ]
      })
      return node.id
    })
    await editor.loadFontsForNodes([host])
    editor.select([host])
    editor.undo.clear()
    return { host, children }
  })
}

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: Walktour applies and undoes steps, renders editable targets, and remaps renamed children`, async ({
    page
  }) => {
    const canvas = await prepareExpansionModules(page, renderer, ['walktour'])
    await insertExpansionModule(page, 'walktour')
    const fixture = await addEditableTargets(page),
      original = await selectedExpansionConfig(page)
    const rows = page.getByTestId('walktour-step-row')
    await expect(rows).toHaveCount(3)
    await rows.first().getByTestId('walktour-step-title').fill('欢迎体验')
    await rows.first().getByTestId('walktour-step-content').fill('第一行\nSecond line')
    await rows.first().getByTestId('walktour-step-target').click()
    await page.getByRole('option', { name: 'First card', exact: true }).click()
    await rows.first().getByTestId('walktour-step-placement').click()
    await page.getByRole('option', { name: 'Right', exact: true }).click()
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await page.getByTestId('walktour-apply').click()
    const updated = await selectedExpansionConfig(page)
    expect(updated.steps).toEqual(
      expect.arrayContaining([
        {
          id: 'welcome',
          title: '欢迎体验',
          content: '第一行\nSecond line',
          targetChildName: 'First card',
          placement: 'right'
        }
      ])
    )
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    await expect.poll(() => selectedExpansionConfig(page)).toEqual(original)
    await canvas.redo()
    await expect.poll(() => selectedExpansionConfig(page)).toEqual(updated)
    await waitForExpansionPaint(canvas, [23, 43, 77])
    await expect(page).toHaveScreenshot(`${renderer}-walktour-children.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })

    const disclosure = page
      .locator(`[data-node-id="${fixture.host}"]`)
      .getByTestId('layers-item')
      .locator('[data-slot="disclosure"]')
    if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click()
    await page
      .locator(`[data-node-id="${fixture.children[0]}"]`)
      .getByTestId('layers-item')
      .dblclick()
    const rename = page.getByTestId('layers-item-input')
    await rename.fill('Renamed target')
    await rename.press('Enter')
    await selectContentLayer(page, fixture.host)
    await expect(rows.first().getByTestId('walktour-step-target')).toContainText(
      'Target unavailable: First card'
    )
    await rows.first().getByTestId('walktour-step-target').click()
    await page.getByRole('option', { name: 'Renamed target', exact: true }).click()
    await page.getByTestId('walktour-apply').click()
    expect((await selectedExpansionConfig(page)).steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'welcome', targetChildName: 'Renamed target' })
      ])
    )
    const trigger = expansionField(page, 'triggerLabel').getByRole('textbox')
    await trigger.fill('开始引导')
    await trigger.press('Tab')
    await waitForExpansionPaint(canvas, [23, 43, 77])
    await expect(page).toHaveScreenshot(`${renderer}-walktour-renamed.png`, {
      clip: await selectedModuleClip(page),
      animations: 'disabled',
      maxDiffPixelRatio: 0
    })
    await rows.first().getByTestId('walktour-step-title').fill('')
    await page.getByTestId('walktour-apply').click()
    await expect(page.getByTestId('walktour-draft-error')).toBeVisible()
    await page.getByTestId('walktour-cancel').click()
    await expect(rows.first().getByTestId('walktour-step-title')).toHaveValue('欢迎体验')
    canvas.assertNoErrors()
  })

  test(`${renderer}: Walktour old inputs and apply buttons cannot cross selection or retained sessions`, async ({
    page
  }) => {
    const canvas = await prepareExpansionModules(page, renderer, ['walktour'])
    await insertExpansionModule(page, 'walktour')
    const first = await selectedContentNodeId(page),
      original = await selectedExpansionConfig(page)
    await insertExpansionModule(page, 'walktour')
    const second = await selectedContentNodeId(page)
    const title = page.getByTestId('walktour-step-title').first()
    await title.fill('Unapplied second')
    const staleInput = await title.elementHandle(),
      staleApply = await page.getByTestId('walktour-apply').elementHandle()
    if (!staleInput || !staleApply) throw new Error('Missing tour controls')
    await selectContentLayer(page, first)
    await title.fill('Fresh first draft')
    await staleInput.evaluate((element) => {
      ;(element as HTMLInputElement).value = 'Late draft'
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await staleApply.evaluate((element) =>
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    await expect(title).toHaveValue('Fresh first draft')
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await selectContentLayer(page, second)
    await title.fill('Hidden draft')
    const hiddenApply = await page.getByTestId('walktour-apply').elementHandle()
    if (!hiddenApply) throw new Error('Missing retained control')
    await canvas.click(12, 12)
    await expect(page.getByTestId('design-panel-empty')).toBeVisible()
    await selectContentLayer(page, second)
    await title.fill('Restored draft')
    await hiddenApply.evaluate((element) =>
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    await expect(title).toHaveValue('Restored draft')
    expect(await selectedExpansionConfig(page)).toEqual(original)
    await page.getByTestId('walktour-apply').click()
    expect((await selectedExpansionConfig(page)).steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Restored draft' })])
    )
    await staleInput.dispose()
    await staleApply.dispose()
    await hiddenApply.dispose()
    canvas.assertNoErrors()
  })
}
