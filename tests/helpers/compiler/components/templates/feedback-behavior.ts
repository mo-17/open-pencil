import { expect, type Page } from '@playwright/test'

export async function exerciseFeedbackTemplate(page: Page, id: string): Promise<boolean> {
  if (id === 'alert') {
    await expect(page.getByRole('status')).toContainText('温馨提示')
    await page.getByRole('button', { name: '关闭提示', exact: true }).click()
    await expect(page.getByRole('button', { name: '关闭提示', exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('status')).toContainText('温馨提示')
    return true
  }
  if (id === 'progress' || id === 'circular-progress') {
    const progress = page.getByRole('progressbar', { name: '示例进度', exact: true })
    await expect(progress).toHaveAttribute('aria-valuenow', '65')
    await expect(progress).toHaveAttribute('aria-valuemin', '0')
    await expect(progress).toHaveAttribute('aria-valuemax', '100')
    return true
  }
  if (id === 'chip') {
    const label = page.getByRole('button', { name: '设计', exact: true })
    await expect(label).toHaveAttribute('aria-pressed', 'true')
    await label.focus()
    await label.press('Space')
    await expect(label).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: '移除标签: 设计', exact: true }).click()
    await expect(label).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveText('设计: 标签已移除')
    await page.reload()
    await expect(label).toHaveAttribute('aria-pressed', 'true')
    return true
  }
  return false
}
