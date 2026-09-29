import { expect, type Page } from '@playwright/test'

import type { TemplateId } from './fixture'

export async function exerciseChartTemplate(page: Page, id: TemplateId): Promise<boolean> {
  if (!id.endsWith('-chart')) return false
  const chart = page.locator('[data-openpencil-chart]')
  await expect(chart).toBeVisible()
  await expect(chart.getByRole('img')).toBeVisible()
  const circular = id === 'pie-chart' || id === 'donut-chart'
  const cells = chart.locator('table')
  await expect(cells.locator('tbody tr')).toHaveCount(circular ? 3 : 4)
  await expect(cells).toContainText(circular ? '开发' : '二月')
  await expect(cells).toContainText(circular ? '45' : '-12')
  return true
}
