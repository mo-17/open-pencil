import { expect, type Page } from '@playwright/test'

import type { TemplateId } from './fixture'

async function prepareMultipleSelect(page: Page): Promise<void> {
  const trigger = page.getByRole('combobox', { name: '项目方向', exact: true })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await page.getByRole('searchbox').fill('')
  const list = page.getByRole('listbox')
  await expect(list).toHaveAttribute('aria-multiselectable', 'true')
  for (const name of ['设计', '开发']) {
    const option = list.getByRole('option', { name, exact: true })
    if ((await option.getAttribute('aria-selected')) !== 'true') await option.click()
    await expect(option).toHaveAttribute('aria-selected', 'true')
  }
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(list).toBeVisible()
  await expect(page.getByText('已选值: design,development', { exact: true })).toBeVisible()
}

async function prepareDateRange(page: Page): Promise<void> {
  const range = page.locator('[data-openpencil-date-range]')
  const start = range.getByLabel('开始日期', { exact: true })
  const end = range.getByLabel('结束日期', { exact: true })
  await start.fill('2026-10-02')
  await end.fill('2026-10-07')
  await expect(start).toHaveValue('2026-10-02')
  await expect(end).toHaveValue('2026-10-07')
  await expect(range.getByRole('status')).toHaveText('已选择日期范围。')
  await expect(range.getByRole('button', { name: '清空', exact: true })).toBeEnabled()
}

async function revealFullTree(page: Page): Promise<void> {
  const search = page.getByRole('searchbox', { name: '搜索树节点', exact: true })
  await search.fill('')
  const tree = page.getByRole('tree', { name: '项目结构', exact: true })
  const root = tree.getByRole('treeitem', { name: '项目', exact: true })
  if ((await root.getAttribute('aria-expanded')) !== 'true') await root.press('ArrowRight')
  await expect(search).toHaveValue('')
  await expect(root).toHaveAttribute('aria-expanded', 'true')
  await expect(tree.getByRole('treeitem')).toHaveCount(5)
  await expect(tree.getByRole('treeitem', { name: '开发', exact: true })).toBeVisible()
  await expect(tree.getByRole('treeitem', { name: '归档', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
}

async function prepareTreeSelect(page: Page): Promise<void> {
  const trigger = page.getByRole('combobox', { name: '项目结构', exact: true })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await revealFullTree(page)
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('tree', { name: '项目结构', exact: true })).toBeVisible()
}

async function preparePopup(page: Page, confirmation: boolean): Promise<void> {
  const trigger = page.getByRole('button', {
    name: confirmation ? '确认此选择' : '查看项目详情',
    exact: true
  })
  const dialog = page.getByRole('dialog', {
    name: confirmation ? '确认此本地示例？' : '项目详情',
    exact: true
  })
  if (!(await dialog.isVisible())) await trigger.click()
  await expect(dialog).toBeVisible()
  if (confirmation) {
    await expect(dialog).toContainText('不会保存或删除数据')
    await expect(dialog.getByRole('button', { name: '确认', exact: true })).toBeEnabled()
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeEnabled()
  } else await expect(dialog).toContainText('在设计面板编辑这些文字')
}

const INPUT_EVIDENCE: Partial<Record<TemplateId, (page: Page) => Promise<void>>> = {
  'multi-select': prepareMultipleSelect,
  'date-range': prepareDateRange,
  tree: revealFullTree,
  'tree-select': prepareTreeSelect,
  popover: (page) => preparePopup(page, false),
  popconfirm: (page) => preparePopup(page, true)
}

/** Leave only the six input templates in an asserted, useful state for caller-owned screenshots. */
export async function prepareInputTemplateEvidence(page: Page, id: TemplateId): Promise<boolean> {
  const prepare = INPUT_EVIDENCE[id]
  if (!prepare) return false
  await prepare(page)
  return true
}
