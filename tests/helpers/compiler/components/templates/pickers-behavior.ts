import { expect, type Page } from '@playwright/test'

import type { TemplateId } from './fixture'

export async function exercisePickerTemplate(page: Page, id: TemplateId): Promise<boolean> {
  if (id === 'color-picker') {
    const input = page.getByRole('textbox', { name: '主题颜色', exact: true })
    await expect(input).toHaveValue('#2563eb')
    const picker = page.getByLabel(/(?:选择颜色|Choose color): 主题颜色/, { exact: true })
    await picker.evaluate((element: HTMLInputElement) => {
      element.value = '#16a34a'
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(input).toHaveValue('#16a34a')
    await expect(page.getByText('颜色值: #16a34a', { exact: true })).toBeVisible()
    return true
  }
  if (id === 'descriptions') {
    const host = page.locator('[data-openpencil-descriptions]')
    await expect(host.locator('dl')).toHaveAttribute('aria-label', '项目详情')
    await expect(host.locator('dt')).toHaveText([
      '项目',
      '状态',
      '负责人',
      '更新日期',
      '分类',
      '说明'
    ])
    await expect(host.locator('dd').first()).toHaveText('设计工作区')
    await host.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(host.locator('dd').last()).toBeInViewport()
    expect(await host.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true
    )
    await host.evaluate((element) => {
      element.scrollTop = 0
    })
    return true
  }
  return false
}
