import { expect, type Page } from '@playwright/test'
export async function exerciseFoundationTemplate(page: Page, id: string): Promise<boolean> {
  if (id === 'tooltip') {
    const trigger = page.getByRole('button', { name: '查看使用说明', exact: true })
    await trigger.focus()
    await expect(page.getByRole('tooltip')).toContainText('按 Escape 关闭')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    return true
  }
  if (id === 'skeleton') {
    await expect(page.getByRole('status', { name: '正在加载内容', exact: true })).toBeVisible()
    await expect(page.locator('[data-skeleton-line]')).toHaveCount(3)
    await expect(page.getByRole('progressbar')).toHaveCount(0)
    return true
  }
  if (id === 'empty-state' || id === 'empty-search') {
    await expect(
      page.getByText(id === 'empty-state' ? '这里还没有内容' : '没有匹配结果', { exact: true })
    ).toBeVisible()
    await expect(page.locator('[data-empty-illustration]')).toHaveCount(1)
    await expect(page.locator('[data-openpencil-empty-state]').getByRole('button')).toHaveCount(0)
    return true
  }
  return false
}
