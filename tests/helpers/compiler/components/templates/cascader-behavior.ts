import { expect, type Page } from '@playwright/test'

export async function exerciseCascaderTemplate(page: Page, id: string): Promise<boolean> {
  if (id !== 'cascader') return false
  const root = page.locator('[data-openpencil-cascader]')
  const trigger = root.getByRole('combobox', { name: '地区', exact: true })
  await expect(trigger).toContainText('亚洲 / 中国 / 厦门')
  await expect(page.getByText('已选路径: asia,china,xiamen', { exact: true })).toBeVisible()
  await trigger.click()
  await expect(root.locator('[data-cascader-id="archived"]')).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await root.getByRole('searchbox').fill('巴黎')
  await root.getByRole('treeitem', { name: '欧洲 / 法国 / 巴黎', exact: true }).click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('已选路径: europe,france,paris', { exact: true })).toBeVisible()
  await root.getByRole('button', { name: '清除选择', exact: true }).click()
  await expect(trigger).toContainText('选择城市')
  await trigger.click()
  await root.locator('[data-cascader-id="asia"]').click()
  await root.locator('[data-cascader-id="china"]').click()
  await root.locator('[data-cascader-id="xiamen"]').click()
  await expect(page.getByText('已选路径: asia,china,xiamen', { exact: true })).toBeVisible()
  return true
}
