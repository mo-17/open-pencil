import { expect, type Page } from '@playwright/test'

import type { TemplateId } from './fixture'

export async function exerciseOrgChartTemplate(page: Page, id: TemplateId): Promise<boolean> {
  if (id !== 'org-chart') return false
  const chart = page.locator('[data-openpencil-org-chart]')
  const card = (name: string) => chart.locator(`[data-org-id="${name}"]`)
  await expect(card('team')).toHaveAttribute('aria-expanded', 'true')
  await expect(card('frontend')).toBeVisible()
  await card('engineering').locator('[data-org-toggle]').click()
  await expect(card('engineering')).toHaveAttribute('aria-expanded', 'false')
  await expect(card('frontend')).toHaveCount(0)
  await expect(card('design')).toBeVisible()
  const expand = card('engineering').locator('[data-org-toggle]')
  await expand.focus()
  await expand.press('Enter')
  await expect(card('frontend')).toBeVisible()
  await card('team').locator('[data-org-toggle]').click()
  await expect(chart.locator('[data-org-id]')).toHaveCount(1)
  await card('team').locator('[data-org-toggle]').click()
  await expect(chart.locator('[data-org-id]')).toHaveCount(5)
  return true
}
