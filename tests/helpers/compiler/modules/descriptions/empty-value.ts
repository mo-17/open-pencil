import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/** Blank authored values keep one display line without inserting business text. */
export async function expectDescriptionsEmptyValue(page: Page, host: Locator): Promise<void> {
  await page.getByRole('button', { name: 'Empty value', exact: true }).click()
  await host.evaluate((element) => {
    element.style.width = '320px'
    element.scrollTop = 0
  })
  const items = host.locator('[data-description-item]')
  const value = items.first().locator('dd')
  await expect(value).toHaveText('')
  expect(await value.textContent()).toBe('')
  const emptyValue = await value.boundingBox()
  const emptyNext = await items.nth(1).boundingBox()
  if (!emptyValue || !emptyNext) throw new Error('Descriptions empty value geometry missing')
  await page.getByRole('button', { name: 'Fill value', exact: true }).click()
  await expect(value).toHaveText('One line')
  const filledValue = await value.boundingBox()
  const filledNext = await items.nth(1).boundingBox()
  if (!filledValue || !filledNext) throw new Error('Descriptions filled value geometry missing')
  expect(filledValue.height).toBe(emptyValue.height)
  expect(filledNext.y).toBe(emptyNext.y)
}
