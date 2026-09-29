import { expect, type Page } from '@playwright/test'

import type { TemplateId } from './fixture'

export async function exerciseContentTemplate(page: Page, id: TemplateId): Promise<boolean> {
  if (id === 'code-block') {
    const block = page.locator('[data-openpencil-code-block]')
    await expect(block).toContainText('你好，OpenPencil')
    await expect(block.getByRole('button', { name: '复制', exact: true })).toBeVisible()
    await expect(block).toContainText('本地示例')
    return true
  }
  if (id !== 'markdown-note' && id !== 'markdown-table') return false
  const markdown = page.locator('[data-openpencil-markdown]')
  await expect(markdown).toBeVisible()
  if (id === 'markdown-table') {
    await expect(markdown.getByRole('table').locator('tbody tr')).toHaveCount(2)
    await expect(markdown.getByRole('checkbox')).toHaveCount(2)
    await expect(markdown.getByRole('checkbox').first()).toBeChecked()
    await expect(markdown.getByRole('checkbox').first()).toBeDisabled()
  } else {
    await expect(markdown.getByRole('heading', { name: '快速开始' })).toBeVisible()
    await expect(markdown.locator('li')).toHaveCount(3)
    await expect(markdown.locator('blockquote')).toContainText('修改保存在文档中')
  }
  return true
}
