import { expect, type Page } from '@playwright/test'

import type { TemplateId } from './fixture'

export async function exerciseAdvancedFieldTemplate(page: Page, id: TemplateId): Promise<boolean> {
  if (id === 'date-time-picker') {
    const input = page.getByLabel('预约时间', { exact: true })
    await expect(input).toHaveValue('2026-09-28T09:30')
    await input.fill('2026-10-02T14:45')
    await expect(page.getByText('当前值: 2026-10-02T14:45', { exact: true })).toBeVisible()
    return true
  }
  if (id === 'number-input') {
    const input = page.getByRole('spinbutton', { name: '数量', exact: true })
    await expect(input).toHaveValue('2')
    await page.getByRole('button', { name: /增加|Increase/ }).click()
    await expect(input).toHaveValue('3')
    await page.getByRole('button', { name: /减少|Decrease/ }).click()
    await expect(page.getByText('当前值: 2', { exact: true })).toBeVisible()
    await input.fill('')
    await expect(input).toHaveValue('')
    await input.fill('5')
    return true
  }
  if (id === 'password-input') {
    const input = page.getByLabel('密码', { exact: true })
    await expect(input).toHaveAttribute('type', 'password')
    await expect(input).toHaveValue('')
    await input.fill('example-only')
    await page.getByRole('button', { name: /显示密码|Show password/ }).click()
    await expect(input).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: /隐藏密码|Hide password/ }).click()
    await expect(input).toHaveAttribute('type', 'password')
    await expect(page.getByText('example-only', { exact: true })).toHaveCount(0)
    return true
  }
  return false
}
