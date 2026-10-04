import { expect, test } from '@playwright/test'

import { withPageViewport } from '#tests/helpers/compiler/page-viewport/browser'

test.use({ viewport: { width: 390, height: 480 } })

for (const target of ['react', 'vue'] as const) {
  for (const mode of ['responsive', 'fit-width'] as const) {
    test(`${target} ${mode} preserves state, normalized bounds, scrolling and hit targets across device widths`, async ({
      page
    }, info) => {
      await withPageViewport(page, target, mode, async () => {
        const host = page.locator('[data-op-page-viewport-host]')
        const canvas = page.locator('[data-op-page-viewport]')
        await expect(canvas).toHaveCount(1)
        await expect(page.getByText('Count 0', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Increment', exact: true }).click()
        await expect(page.getByText('Count 1', { exact: true })).toBeVisible()
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 360 })
          await expect
            .poll(() => canvas.evaluate((element) => element.getBoundingClientRect().width))
            .toBeCloseTo(width, 0)
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
          ).toBe(true)
          const box = await canvas.boundingBox()
          if (!box) throw new Error('Viewport canvas was not measured')
          expect(box.x).toBeCloseTo(0, 0)
          if (mode === 'fit-width') expect(box.height).toBeCloseTo((1200 * width) / 800, 0)
          await expect(page.getByText('Count 1', { exact: true })).toBeAttached()
        }
        await page.setViewportSize({ width: 390, height: 360 })
        expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(
          true
        )
        await page.getByRole('button', { name: 'Last action', exact: true }).click()
        await expect(page.getByText('Count 2', { exact: true })).toBeAttached()
        // Measure the actual padded host content box, including constrained embeds.
        await host.evaluate((element) => {
          element.style.boxSizing = 'border-box'
          element.style.width = '300px'
          element.style.paddingInline = '20px'
        })
        await expect
          .poll(() => canvas.evaluate((element) => element.getBoundingClientRect().width))
          .toBeCloseTo(260, 0)
        await page.getByRole('button', { name: 'Increment', exact: true }).click()
        await expect(page.getByText('Count 3', { exact: true })).toBeVisible()
        await page.screenshot({
          path: info.outputPath(`${target}-${mode}-390.png`),
          fullPage: true
        })
      })
    })
  }

  test(`${target} responsive effective layout height follows both free-to-flow and flow-to-free breakpoints`, async ({
    page
  }, info) => {
    await withPageViewport(page, target, 'bands', async () => {
      const freeToFlow = page.locator('[data-op-page-viewport] > div').nth(0)
      const flowToFree = page.locator('[data-op-page-viewport] > div').nth(1)
      await page.getByRole('button', { name: 'Band increment', exact: true }).click()
      for (const width of [320, 390, 768, 1440, 390]) {
        await page.setViewportSize({ width, height: 480 })
        await expect
          .poll(() => freeToFlow.evaluate((element) => getComputedStyle(element).height))
          .toBe(width < 1280 ? '152px' : '400px')
        await expect
          .poll(() => flowToFree.evaluate((element) => getComputedStyle(element).height))
          .toBe(width < 1280 ? '600px' : '112px')
        await expect(page.getByText('Band count 1', { exact: true })).toBeAttached()
      }
      await page.getByRole('button', { name: 'Band increment', exact: true }).click()
      await expect(page.getByText('Band count 2', { exact: true })).toBeVisible()
      await page.screenshot({
        path: info.outputPath(`${target}-resolved-bands-390.png`),
        fullPage: true
      })
    })
  })
}
