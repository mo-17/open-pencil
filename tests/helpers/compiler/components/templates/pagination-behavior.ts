import { expect, type Page } from '@playwright/test'

import type { TemplateId } from './fixture'

export async function exercisePaginationTemplate(page: Page, id: TemplateId): Promise<boolean> {
  if (id !== 'pagination' && id !== 'paginated-list') return false
  const navigation = page.getByRole('navigation', { name: '浏览分页', exact: true })
  const number = (value: number) =>
    navigation.getByRole('button').filter({ hasText: new RegExp(`^${value}$`) })
  await expect(number(1)).toHaveAttribute('aria-current', 'page')
  if (id === 'paginated-list') {
    await expect(page.getByText('记录 1', { exact: true })).toBeVisible()
    await expect(page.getByText('记录 4', { exact: true })).toHaveCount(0)
  }
  await number(2).click()
  await expect(number(2)).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('当前页: 2', { exact: true })).toBeVisible()
  if (id === 'paginated-list') {
    await expect(page.getByText('记录 1', { exact: true })).toHaveCount(0)
    await expect(page.getByText('记录 4', { exact: true })).toBeVisible()
    await expect(page.getByText('记录 6', { exact: true })).toBeVisible()
    await expect(page.getByText('记录 7', { exact: true })).toHaveCount(0)
  }
  await number(4).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('当前页: 4', { exact: true })).toBeVisible()
  if (id === 'paginated-list') {
    await expect(page.getByText('记录 10', { exact: true })).toBeVisible()
    await expect(page.getByText('记录 12', { exact: true })).toBeVisible()
    await expect(page.getByText('记录 4', { exact: true })).toHaveCount(0)
  }
  return true
}
