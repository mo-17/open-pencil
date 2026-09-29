import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import {
  expansionField,
  selectedExpansionConfig,
  selectedModuleClip,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'

test.use({ viewport: { width: 1600, height: 1100 } })

async function insertChart(page: Page) {
  await page.getByTestId('toolbar-plugin-modules').click()
  await page.getByTestId('toolbar-plugin-module-open-pencil.chart-chart').click()
  await expect(page.getByTestId('chart-data-editor')).toBeVisible()
}

async function prepareChart(page: Page, renderer: 'retained' | 'tiled') {
  await page.goto(`/?test&no-rulers&renderer=${renderer}`)
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await page.getByTestId('settings-plugins-view').getByText('Browse', { exact: true }).click()
  await page.getByTestId('plugin-discover-search').fill('Chart')
  await page.getByTestId('plugin-install-open-pencil.chart').click()
  await expect(page.getByTestId('plugin-installed-open-pencil.chart')).toBeVisible()
  await page.getByTestId('plugin-enabled-open-pencil.chart').click()
  await page.getByTestId('app-settings-done').click()
  await insertChart(page)
  return canvas
}

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: all five chart styles paint authored Chinese labels`, async ({ page }) => {
    test.setTimeout(120_000)
    const canvas = await prepareChart(page, renderer)
    const rows = page.getByTestId('chart-data-row')
    for (const [index, label] of ['一季度', '二季度', '三季度', '四季度'].entries())
      await rows.nth(index).getByRole('textbox', { name: 'Label', exact: true }).fill(label)
    await page.getByTestId('chart-data-apply').click()
    const type = expansionField(page, 'chartType').getByRole('combobox')
    for (const chartType of ['bar', 'line', 'area', 'pie', 'donut']) {
      await type.blur()
      await type.focus()
      await type.selectOption(chartType)
      expect(await selectedExpansionConfig(page)).toMatchObject({
        chartType,
        labels: ['一季度', '二季度', '三季度', '四季度']
      })
      await waitForExpansionPaint(canvas, [51, 65, 85])
      await expect(page).toHaveScreenshot(`${renderer}-chart-${chartType}.png`, {
        clip: await selectedModuleClip(page),
        animations: 'disabled',
        maxDiffPixelRatio: 0
      })
    }
    canvas.assertNoErrors()
  })

  test(`${renderer}: chart data pairs apply atomically and retain invalid drafts`, async ({
    page
  }) => {
    const canvas = await prepareChart(page, renderer)
    const before = await selectedExpansionConfig(page)
    const rows = page.getByTestId('chart-data-row')
    await expect(rows).toHaveCount(4)
    await expect(expansionField(page, 'labels')).toHaveCount(0)
    await rows.first().getByRole('textbox', { name: 'Label', exact: true }).fill('一季度')
    const value = rows.first().getByRole('textbox', { name: 'Value', exact: true })
    await value.fill('not a number')
    await page.getByTestId('chart-data-apply').click()
    await expect(page.getByTestId('chart-data-error')).toBeVisible()
    await expect(value).toHaveValue('not a number')
    expect(await selectedExpansionConfig(page)).toEqual(before)
    await value.fill('-12.5')
    await page.getByTestId('chart-data-add').click()
    await expect(rows).toHaveCount(5)
    await page.getByTestId('chart-data-apply').click()
    expect(await selectedExpansionConfig(page)).toMatchObject({
      labels: ['一季度', 'Q2', 'Q3', 'Q4', 'New item'],
      values: [-12.5, 68, 46, 84, 0]
    })
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    expect(await selectedExpansionConfig(page)).toEqual(before)
    await expect(rows).toHaveCount(4)
    await rows.first().getByRole('textbox', { name: 'Value', exact: true }).fill('99')
    await page.getByTestId('chart-data-cancel').click()
    await expect(rows.first().getByRole('textbox', { name: 'Value', exact: true })).toHaveValue(
      '32'
    )
    expect(await selectedExpansionConfig(page)).toEqual(before)
    canvas.assertNoErrors()
  })

  test(`${renderer}: chart drafts expire before late events target another node`, async ({
    page
  }) => {
    const canvas = await prepareChart(page, renderer)
    const first = await page.evaluate(() => [...window.openPencil.getStore().state.selectedIds][0])
    await insertChart(page)
    const before = await selectedExpansionConfig(page)
    const value = page
      .getByTestId('chart-data-row')
      .first()
      .getByRole('textbox', { name: 'Value', exact: true })
    await value.fill('777')
    const oldInput = await value.elementHandle()
    const oldApply = await page.getByTestId('chart-data-apply').elementHandle()
    if (!oldInput || !oldApply || !first) throw new Error('Chart draft controls unavailable')
    try {
      await page.locator(`[data-node-id="${first}"]`).getByTestId('layers-item').click()
      await expect.poll(() => oldInput.evaluate((element) => element.isConnected)).toBe(false)
      await oldInput.evaluate((element) => {
        element.dispatchEvent(new FocusEvent('focus'))
        element.value = '999'
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await oldApply.evaluate((element) => element.click())
      expect(await selectedExpansionConfig(page)).toEqual(before)
      await expect(
        page
          .getByTestId('chart-data-row')
          .first()
          .getByRole('textbox', { name: 'Value', exact: true })
      ).toHaveValue('32')
      canvas.assertNoErrors()
    } finally {
      await oldInput.dispose()
      await oldApply.dispose()
    }
  })

  test(`${renderer}: circular chart data rejects negatives without losing the draft`, async ({
    page
  }) => {
    const canvas = await prepareChart(page, renderer)
    const type = expansionField(page, 'chartType').getByRole('combobox')
    const firstValue = page
      .getByTestId('chart-data-row')
      .first()
      .getByRole('textbox', { name: 'Value', exact: true })
    await firstValue.fill('-12')
    await page.getByTestId('chart-data-apply').click()
    await type.focus()
    await type.selectOption('pie')
    await expect(expansionField(page, 'chartType')).toContainText('non-negative')
    await expect(type).toHaveValue('bar')
    expect(await selectedExpansionConfig(page)).toMatchObject({
      chartType: 'bar',
      values: [-12, 68, 46, 84]
    })
    await firstValue.fill('32')
    await page.getByTestId('chart-data-apply').click()
    await type.focus()
    await type.selectOption('pie')
    const before = await selectedExpansionConfig(page)
    const value = page
      .getByTestId('chart-data-row')
      .first()
      .getByRole('textbox', { name: 'Value', exact: true })
    await value.fill('-1')
    await page.getByTestId('chart-data-apply').click()
    await expect(page.getByTestId('chart-data-error')).toContainText('non-negative')
    await expect(value).toHaveValue('-1')
    expect(await selectedExpansionConfig(page)).toEqual(before)
    await value.fill('15')
    await page.getByTestId('chart-data-apply').click()
    expect(await selectedExpansionConfig(page)).toMatchObject({
      chartType: 'pie',
      values: [15, 68, 46, 84]
    })
    canvas.assertNoErrors()
  })
}
