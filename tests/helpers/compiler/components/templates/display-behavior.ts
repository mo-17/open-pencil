import { expect, type Page } from '@playwright/test'

export async function exerciseDisplayTemplate(page: Page, id: string): Promise<boolean> {
  if (id === 'avatar') {
    await expect(page.getByRole('img', { name: '林梅', exact: true })).toBeVisible()
    await expect(page.getByText('林', { exact: true })).toBeVisible()
    return true
  }
  if (id === 'badge' || id === 'dot-badge') {
    await expect(page.getByText('消息', { exact: true })).toBeVisible()
    if (id === 'badge') {
      await expect(page.getByText('99+', { exact: true })).toBeVisible()
      await expect(page.getByText('示例数量: 128', { exact: true })).toBeAttached()
    } else await expect(page.getByText('99+', { exact: true })).toHaveCount(0)
    return true
  }
  if (id === 'timeline') {
    const timeline = page.getByRole('list', { name: '项目时间线', exact: true })
    await expect(timeline.getByRole('listitem')).toHaveCount(3)
    await expect(timeline.getByRole('listitem').first()).toContainText('调研完成')
    await expect(timeline.getByRole('listitem').nth(1)).toContainText('10:30')
    await expect(timeline.getByRole('listitem').last()).toContainText('等待评审')
    return true
  }
  return false
}
