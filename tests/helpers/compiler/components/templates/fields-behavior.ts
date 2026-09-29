import { expect, type Page } from '@playwright/test'

import type { TemplateId } from './fixture'

export async function exerciseFieldTemplate(page: Page, id: TemplateId): Promise<boolean> {
  if (id === 'autocomplete') {
    const input = page.getByRole('combobox', { name: '目的地', exact: true })
    await input.fill('泉')
    await expect(page.getByRole('option')).toHaveText('泉州')
    await input.press('ArrowDown')
    await input.press('Enter')
    await expect(page.getByText('当前值: 泉州', { exact: true })).toBeVisible()
    await input.fill('自定义目的地')
    await input.press('Escape')
    await expect(page.getByText('当前值: 自定义目的地', { exact: true })).toBeVisible()
    return true
  }
  if (id !== 'time-picker') return false
  const input = page.getByLabel('开始时间', { exact: true })
  await expect(input).toHaveValue('09:30')
  await input.fill('10:45')
  await expect(page.getByText('当前值: 10:45', { exact: true })).toBeVisible()
  await expect(input).toHaveAttribute('step', '900')
  await input.fill('07:00')
  expect(await input.evaluate((element: HTMLInputElement) => element.validity.rangeUnderflow)).toBe(
    true
  )
  await input.fill('10:45')
  return true
}

export async function prepareFieldTemplateEvidence(page: Page, id: TemplateId): Promise<boolean> {
  if (id !== 'autocomplete') return id === 'time-picker'
  const input = page.getByRole('combobox', { name: '目的地', exact: true })
  await input.fill('')
  await input.click()
  await expect(page.getByRole('option')).toHaveCount(3)
  await input.press('ArrowDown')
  return true
}
