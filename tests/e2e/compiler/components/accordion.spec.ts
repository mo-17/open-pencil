import { expect, test } from '@playwright/test'

import { withAccordion } from '#tests/helpers/compiler/modules/accordion/browser'

test.use({ viewport: { width: 1000, height: 720 } })

for (const target of ['react', 'vue'] as const) {
  test(`${target} accordion supports independent sections, keyboard navigation and wrapped plain text`, async ({
    page
  }, info) => {
    await withAccordion(page, target, async () => {
      const accordions = page.locator('[data-openpencil-accordion]')
      await expect(accordions).toHaveCount(2)
      const first = accordions.nth(0),
        second = accordions.nth(1)
      const headings = first.getByRole('button')
      await expect(headings.nth(0)).toHaveAttribute('aria-expanded', 'true')
      await expect(first.locator('[data-accordion-panel]').first()).toHaveCSS(
        'white-space',
        'pre-wrap'
      )
      await headings.nth(0).focus()
      await page.keyboard.press('ArrowDown')
      await expect(headings.nth(1)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(headings.nth(0)).toHaveAttribute('aria-expanded', 'false')
      await expect(headings.nth(1)).toHaveAttribute('aria-expanded', 'true')
      await expect(
        first.getByText('<img src=x onerror=alert(1)> 作为纯文本显示。', { exact: true })
      ).toBeVisible()
      await expect(first.locator('img')).toHaveCount(0)
      await page.keyboard.press('End')
      await expect(headings.nth(2)).toBeFocused()
      await page.keyboard.press('Space')
      await expect(headings.nth(2)).toHaveAttribute('aria-expanded', 'true')
      expect(
        await first.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
      ).toBe(true)
      await second.getByRole('button').nth(1).click()
      await expect(second.getByRole('button').nth(0)).toHaveAttribute('aria-expanded', 'true')
      await expect(second.getByRole('button').nth(1)).toHaveAttribute('aria-expanded', 'true')
      const controls = await page
        .locator('[aria-controls]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-controls')))
      expect(new Set(controls).size).toBe(6)
      await page.screenshot({ path: info.outputPath(`${target}-accordion.png`) })
    })
  })

  test(`${target} accordion preserves local expansion across equal props and resets on changed configuration or remount`, async ({
    page
  }) => {
    await withAccordion(
      page,
      target,
      async () => {
        const accordion = page.locator('[data-openpencil-accordion]')
        const second = accordion.getByRole('button', { name: '可以独立编辑吗？', exact: true })
        await second.click()
        await page.getByRole('button', { name: 'Rerender 0', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Rerender 1', exact: true })).toBeVisible()
        await expect(second).toHaveAttribute('aria-expanded', 'true')
        await page.getByRole('button', { name: 'Toggle multiple', exact: true }).click()
        await expect(accordion.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true')
        await second.click()
        await expect(accordion.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true')
        await expect(second).toHaveAttribute('aria-expanded', 'true')
        await page.getByRole('button', { name: 'Replace items', exact: true }).click()
        await expect(accordion.getByRole('button')).toHaveCount(2)
        await expect(second).toHaveAttribute('aria-expanded', 'true')
        await second.click()
        await page.getByRole('button', { name: 'Toggle mount', exact: true }).click()
        await expect(accordion).toHaveCount(0)
        await page.getByRole('button', { name: 'Toggle mount', exact: true }).click()
        await expect(second).toHaveAttribute('aria-expanded', 'true')
      },
      true
    )
  })
}
