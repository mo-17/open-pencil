import { expect, test } from '@playwright/test'

import { withTree } from '#tests/helpers/compiler/modules/tree/browser'
test.use({ viewport: { width: 375, height: 900 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} Tree keyboard, search and inherited disabled rows stay local and bounded`, async ({
    page
  }) => {
    await withTree(page, target, async () => {
      const current = page.getByRole('region', { name: 'Current tree' }),
        other = page.getByRole('region', { name: 'Other tree' }),
        root = current.getByRole('treeitem', { name: '项目', exact: true }),
        design = current.getByRole('treeitem', {
          name: '中文设计规范与非常长的混合文字 Long label',
          exact: true
        }),
        development = current.getByRole('treeitem', { name: '开发', exact: true })
      await expect(current.getByRole('treeitem')).toHaveCount(5)
      await expect(
        current.getByRole('treeitem', { name: '禁用子节点', exact: true })
      ).toHaveAttribute('aria-disabled', 'true')
      await root.focus()
      await root.press('ArrowRight')
      await expect(design).toBeFocused()
      await expect(design).toHaveAttribute('aria-selected', 'false')
      await design.press('End')
      await expect(development).toBeFocused()
      await development.press('Enter')
      await expect(development).toHaveAttribute('aria-selected', 'true')
      await expect(current.locator('output')).toContainText('[development]')
      await development.press('ArrowLeft')
      await expect(root).toBeFocused()
      await root.press('ArrowLeft')
      await expect(root).toHaveAttribute('aria-expanded', 'false')
      await expect(design).toHaveCount(0)
      await current.getByRole('searchbox', { name: '搜索树节点' }).fill('中文设计')
      await expect(design).toBeVisible()
      await expect(root).toHaveAttribute('aria-expanded', 'true')
      await expect(current.getByRole('treeitem')).toHaveCount(2)
      await current.getByRole('searchbox').fill('无匹配')
      await expect(current.locator('[data-tree-empty]')).toHaveText('没有匹配节点')
      await current.getByRole('searchbox').fill('')
      await expect(design).toHaveCount(0)
      await expect(other.getByRole('treeitem', { name: '开发', exact: true })).toHaveAttribute(
        'aria-selected',
        'false'
      )
      expect(
        await current
          .locator('[data-openpencil-tree]')
          .evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
      ).toBe(true)
    })
  })
  test(`${target} TreeSelect supports independent multi-select, clear, config reset and unmount`, async ({
    page
  }) => {
    await withTree(page, target, async () => {
      const current = page.getByRole('region', { name: 'Current tree' }),
        other = page.getByRole('region', { name: 'Other tree' })
      await page.getByRole('button', { name: 'Mode', exact: true }).click()
      await page.getByRole('button', { name: 'Presentation', exact: true }).click()
      const trigger = current.getByRole('combobox', { name: '项目目录' })
      await expect(current.getByRole('tree')).toHaveCount(0)
      await trigger.press('ArrowDown')
      const root = current.getByRole('treeitem', { name: '项目', exact: true })
      await expect(root).toBeFocused()
      await root.press('Space')
      await expect(root).toHaveAttribute('aria-selected', 'true')
      const development = current.getByRole('treeitem', { name: '开发', exact: true })
      await expect(development).toHaveAttribute('aria-selected', 'false')
      await development.click()
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      await expect(current.locator('output')).toContainText('[project, development]')
      await current.getByRole('searchbox').fill('开发')
      await expect(development).toHaveAttribute('aria-selected', 'true')
      await development.press('Escape')
      await expect(trigger).toBeFocused()
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      await page.getByRole('button', { name: 'Style', exact: true }).click()
      await page.getByRole('textbox', { name: 'Business input' }).fill('Other rerender')
      await expect(current.locator('output')).toContainText('[project, development]')
      await expect(other.locator('output')).toContainText('None selected')
      await current.getByRole('button', { name: '清除选择' }).click()
      await expect(current.locator('output')).toContainText('未选择')
      await expect(trigger).toBeFocused()
      await page.getByRole('button', { name: 'Mode', exact: true }).click()
      await trigger.click()
      await current.getByRole('treeitem', { name: '开发', exact: true }).click()
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      await expect(trigger).toBeFocused()
      await expect(current.locator('output')).toContainText('[development]')
      await page.getByRole('button', { name: 'Disabled', exact: true }).click()
      await expect(trigger).toBeDisabled()
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await expect(current.locator('output')).toContainText('Selected:')
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await expect(current.locator('[data-openpencil-tree]')).toHaveCount(0)
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await expect(current.locator('output')).toContainText('None selected')
      await expect(current.getByRole('tree')).toHaveCount(0)
    })
  })
}
