import { expect, type Page } from '@playwright/test'

import type { TemplateId } from './fixture'

async function exerciseMultipleSelect(page: Page): Promise<void> {
  const select = page.getByRole('combobox', { name: '项目方向', exact: true })
  const native = page.locator('select[multiple]')
  await expect(native).toHaveCount(1)
  const values = () =>
    native.evaluate((element: HTMLSelectElement) =>
      Array.from(element.selectedOptions, (option) => option.value)
    )
  await expect.poll(values).toEqual(['design'])
  await expect(page.getByText('已选值: design', { exact: true })).toBeVisible()
  await select.click()
  await expect(page.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true')
  const search = page.getByRole('searchbox')
  await search.fill('开发')
  await page.getByRole('option', { name: '开发', exact: true }).click()
  await expect(select).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(values).toEqual(['design', 'development'])
  await expect(page.getByText('已选值: design,development', { exact: true })).toBeVisible()
  await search.fill('')
  await expect(page.getByRole('option', { name: '已归档', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await page.getByRole('button', { name: '清空选择', exact: true }).click()
  await expect.poll(values).toEqual([])
  await search.press('Escape')
  await expect(select).toBeFocused()
}

async function exerciseDateRange(page: Page): Promise<void> {
  const range = page.locator('[data-openpencil-date-range]')
  const start = range.getByLabel('开始日期', { exact: true })
  const end = range.getByLabel('结束日期', { exact: true })
  await expect(start).toHaveValue('2026-09-01')
  await expect(end).toHaveValue('2026-09-05')
  await start.fill('2026-09-07')
  await expect(range.getByRole('status')).toHaveText('开始日期不能晚于结束日期。')
  await expect(start).toHaveValue('2026-09-07')
  await end.fill('2026-09-10')
  await expect(range.getByRole('status')).toHaveText('已选择日期范围。')
  await expect(page.getByText('开始日期: 2026-09-07', { exact: true })).toBeVisible()
  await expect(page.getByText('结束日期: 2026-09-10', { exact: true })).toBeVisible()
  await range.getByRole('button', { name: '清空', exact: true }).click()
  await expect(start).toHaveValue('')
  await expect(end).toHaveValue('')
  await expect(start).toBeFocused()
  await expect(range.getByRole('status')).toHaveText('请选择开始和结束日期。')
}

async function exerciseTree(page: Page): Promise<void> {
  const tree = page.getByRole('tree', { name: '项目结构', exact: true })
  const design = tree.getByRole('treeitem', { name: '设计', exact: true })
  const development = tree.getByRole('treeitem', { name: '开发', exact: true })
  await expect(tree).toHaveAttribute('aria-multiselectable', 'true')
  await expect(design).toHaveAttribute('aria-selected', 'true')
  await expect(tree.getByRole('treeitem', { name: '归档', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await design.focus()
  await design.press('ArrowDown')
  await expect(development).toBeFocused()
  await development.press('Space')
  await expect(development).toHaveAttribute('aria-selected', 'true')
  await expect(design).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('searchbox', { name: '搜索树节点', exact: true }).fill('研究')
  await expect(tree.getByRole('treeitem')).toHaveCount(2)
  await expect(tree.getByRole('treeitem', { name: '研究', exact: true })).toBeVisible()
}

async function exerciseTreeSelect(page: Page): Promise<void> {
  const trigger = page.getByRole('combobox', { name: '项目结构', exact: true })
  await expect(trigger).toContainText('设计')
  await expect(page.getByRole('tree')).toHaveCount(0)
  await trigger.press('ArrowDown')
  const development = page.getByRole('treeitem', { name: '开发', exact: true })
  await development.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toContainText('开发')
  await expect(trigger).toBeFocused()
  await page.getByRole('button', { name: '清除选择', exact: true }).click()
  await expect(trigger).toContainText('选择项目条目')
  await expect(trigger).toBeFocused()
}

async function exercisePopover(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: '查看项目详情', exact: true })
  const dialog = page.getByRole('dialog', { name: '项目详情', exact: true })
  await trigger.press('Enter')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('在设计面板编辑这些文字')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
}

async function exercisePopconfirm(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: '确认此选择', exact: true })
  const dialog = page.getByRole('dialog', { name: '确认此本地示例？', exact: true })
  await trigger.click()
  await expect(dialog).toContainText('不会保存或删除数据')
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('已确认；未执行业务操作。')
  await expect(trigger).toBeFocused()
  await trigger.click()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('已取消。')
  await expect(trigger).toBeFocused()
}

const INPUT_BEHAVIORS: Partial<Record<TemplateId, (page: Page) => Promise<void>>> = {
  'multi-select': exerciseMultipleSelect,
  'date-range': exerciseDateRange,
  tree: exerciseTree,
  'tree-select': exerciseTreeSelect,
  popover: exercisePopover,
  popconfirm: exercisePopconfirm
}

export async function exerciseInputTemplate(page: Page, id: TemplateId): Promise<boolean> {
  const exercise = INPUT_BEHAVIORS[id]
  if (!exercise) return false
  await exercise(page)
  return true
}
