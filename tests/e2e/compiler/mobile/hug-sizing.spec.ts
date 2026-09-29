import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

for (const mode of ['GRID', 'VERTICAL'] as const) {
  test(`desktop ${mode} list becomes compact flow without clipping or overlapping HUG cards`, async ({
    page
  }) => {
    const html = execFileSync(
      'bun',
      [
        '-e',
        `import { compactHugHTML } from './tests/helpers/compiler/mobile/hug'; process.stdout.write(await compactHugHTML('${mode}'))`
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await page.setContent(html)
    await page.evaluate(() => {
      document.addEventListener('click', (event) => {
        if (event.target instanceof HTMLButtonElement)
          document.body.dataset.selected = event.target.textContent ?? ''
      })
    })
    const cards = page.locator('[data-card]')
    await expect(cards).toHaveCount(2)
    const siblings = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const rectangle = element.getBoundingClientRect()
        return { top: rectangle.top, bottom: rectangle.bottom }
      })
    )
    expect(siblings[1].top).toBeGreaterThanOrEqual(siblings[0].bottom + 15.9)
    for (const card of await cards.all()) {
      await card.getByRole('button').scrollIntoViewIfNeeded()
      const bounds = await card.evaluate((element) => {
        const rectangle = element.getBoundingClientRect()
        const button = element.querySelector('button')?.getBoundingClientRect()
        return {
          height: rectangle.height,
          bottom: rectangle.bottom,
          buttonBottom: button?.bottom,
          clipped: element.scrollHeight > element.clientHeight + 1,
          minimum: getComputedStyle(element).minHeight,
          overflow: getComputedStyle(element).overflow
        }
      })
      expect(bounds.height).toBeGreaterThanOrEqual(388)
      expect(bounds.minimum).toBe('min-content')
      expect(bounds.overflow).toBe('hidden')
      expect(bounds.clipped).toBe(false)
      expect(bounds.buttonBottom).toBeLessThanOrEqual(bounds.bottom)
      await card.getByRole('button').click()
      await expect(page.locator('body')).toHaveAttribute(
        'data-selected',
        (await card.getByRole('button').textContent()) ?? ''
      )
    }
    // Negative control reproduces the original CSS failure without the intrinsic minimum.
    await cards.evaluateAll((elements) => {
      for (const element of elements) (element as HTMLElement).style.minHeight = '0px'
    })
    expect(
      await cards.first().evaluate((element) => element.scrollHeight > element.clientHeight + 1)
    ).toBe(true)
    await cards.evaluateAll((elements) => {
      for (const element of elements) (element as HTMLElement).style.removeProperty('min-height')
    })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(cards.first()).toHaveCSS('height', '220px')
    await expect(cards.first()).toHaveCSS('overflow', 'hidden')
  })
}
