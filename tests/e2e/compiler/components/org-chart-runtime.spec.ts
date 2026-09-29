import { expect, test } from '@playwright/test'

import { withOrgChart } from '#tests/helpers/compiler/components/org-chart/browser'

test.use({ viewport: { width: 375, height: 1000 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} Org Chart folds independently and supports complete tree keyboard navigation`, async ({
    page
  }) => {
    await withOrgChart(page, target, async () => {
      const main = page.getByRole('tree', { name: 'Live organization', exact: true }),
        other = page.getByRole('tree', { name: 'Other organization', exact: true })
      const root = main.locator('[data-org-id="root"]'),
        design = main.locator('[data-org-id="design"]'),
        designer = main.locator('[data-org-id="designer"]')
      await expect(main.getByRole('treeitem')).toHaveCount(5)
      await expect(root).toHaveAttribute('aria-level', '1')
      await expect(design).toHaveAttribute('aria-posinset', '1')
      await expect(design).toHaveAttribute('aria-setsize', '2')
      await expect(designer).not.toHaveAttribute('aria-expanded')
      await root.focus()
      await page.keyboard.press('ArrowRight')
      await expect(design).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect(designer).toBeFocused()
      await page.keyboard.press('ArrowLeft')
      await expect(design).toBeFocused()
      await page.keyboard.press('ArrowLeft')
      await expect(design).toHaveAttribute('aria-expanded', 'false')
      await expect(main.getByRole('treeitem')).toHaveCount(4)
      await expect(other.getByRole('treeitem')).toHaveCount(5)
      await page.keyboard.press('ArrowDown')
      await expect(main.locator('[data-org-id="engineering"]')).toBeFocused()
      await page.keyboard.press('End')
      await expect(main.locator('[data-org-id="developer"]')).toBeFocused()
      await page.keyboard.press('Home')
      await expect(root).toBeFocused()
      await page.keyboard.press('Space')
      await expect(main.getByRole('treeitem')).toHaveCount(1)
      await expect(root).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(main.getByRole('treeitem')).toHaveCount(4)
      await design.getByRole('button', { name: 'Expand Design team' }).click()
      await expect(main.getByRole('treeitem')).toHaveCount(5)
      await expect(design).toBeFocused()
      await expect(page.locator('output')).toHaveText('Submits[0]')
    })
  })
  test(`${target} Org Chart resets authored config, repairs focus, scrolls narrowly and cleans up`, async ({
    page
  }) => {
    await withOrgChart(page, target, async () => {
      const main = page.getByRole('tree', { name: 'Live organization', exact: true }),
        host = page.locator('[data-openpencil-org-chart]').first()
      const root = main.locator('[data-org-id="root"]'),
        designer = main.locator('[data-org-id="designer"]')
      await designer.focus()
      await page
        .getByRole('button', { name: 'Reset branches', exact: true })
        .evaluate((element: HTMLButtonElement) => element.click())
      await expect(main.getByRole('treeitem')).toHaveCount(1)
      await expect(root).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(main.getByRole('treeitem')).toHaveCount(5)
      await designer.focus()
      await page
        .getByRole('button', { name: 'Remove designer', exact: true })
        .evaluate((element: HTMLButtonElement) => element.click())
      // Config reset honors the initial collapsed root and repairs to its nearest visible ancestor.
      await expect(main.getByRole('treeitem')).toHaveCount(1)
      await expect(root).toBeFocused()
      // An explicit external focus change in the same turn wins over queued restoration.
      await root.focus()
      const direction = page.getByRole('button', { name: 'Direction', exact: true })
      await direction.evaluate((element: HTMLButtonElement) => {
        element.click()
        element.focus()
      })
      await expect(direction).toBeFocused()
      await expect(host).toHaveAttribute('data-direction', 'horizontal')
      await direction.click()
      await page.getByRole('button', { name: 'Collapsible', exact: true }).click()
      await expect(main.getByRole('treeitem')).toHaveCount(4)
      await expect(main.getByRole('button')).toHaveCount(0)
      await page.getByRole('button', { name: 'Direction', exact: true }).click()
      await expect(host).toHaveAttribute('data-direction', 'horizontal')
      await page.getByRole('button', { name: 'Narrow', exact: true }).click()
      await expect(host).toHaveAttribute('data-org-mode', 'compact')
      await expect.poll(() => host.evaluate((element) => element.clientWidth)).toBe(180)
      expect(await page.locator('body').evaluate((element) => element.scrollWidth <= 375)).toBe(
        true
      )
      expect(await host.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
      await page.getByRole('button', { name: 'Collapsible', exact: true }).click()
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await expect(
        root.getByRole('button', { name: '展开 Head office', exact: true })
      ).toBeVisible()
      const stale = await root.getByRole('button').elementHandle()
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await stale?.evaluate((element) =>
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      )
      await expect(
        page.getByRole('tree', { name: 'Other organization', exact: true }).getByRole('treeitem')
      ).toHaveCount(5)
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await expect(main.getByRole('treeitem')).toHaveCount(1)
      await expect(page.locator('output')).toHaveText('Submits[0]')
    })
  })
}
