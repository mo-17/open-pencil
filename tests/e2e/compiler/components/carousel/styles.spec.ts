import { expect, test, type Locator, type Page } from '@playwright/test'

import { withCarouselRuntime } from '#tests/helpers/compiler/modules/carousel/browser'

const LANDSCAPE = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">
<rect width="800" height="400" fill="#bae6fd"/><circle cx="620" cy="84" r="42" fill="#fbbf24"/>
<path d="M0 290L160 70L320 290L450 140L640 340L800 190V400H0Z" fill="#0d9488"/>
<path d="M0 350L220 230L470 370L800 260V400H0Z" fill="#064e3b"/>
<rect x="40" y="30" width="80" height="26" rx="6" fill="#f43f5e"/><rect x="700" y="344" width="70" height="26" rx="6" fill="#a855f7"/>
</svg>`

async function screenshot(page: Page, target: string, variant: string) {
  await page.getByRole('button', { name: 'Outside focus', exact: true }).focus()
  await page.mouse.move(900, 600)
  await page.screenshot({
    path: test.info().outputPath(`${target}-${variant}.png`),
    animations: 'disabled'
  })
  await page.getByRole('region', { name: 'Styled work', exact: true }).screenshot({
    path: test.info().outputPath(`${target}-${variant}-component.png`),
    animations: 'disabled'
  })
}

async function within(container: Locator, item: Locator) {
  await expect
    .poll(async () => {
      const outer = await container.boundingBox()
      const inner = await item.boundingBox()
      return Boolean(
        outer &&
        inner &&
        inner.x >= outer.x - 1 &&
        inner.x + inner.width <= outer.x + outer.width + 1
      )
    })
    .toBe(true)
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} carousel applies authored layout, fit, alignment, shade and pagination styles`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    const requests: string[] = []
    await page.route('https://media.example.com/**', async (route) => {
      requests.push(route.request().url())
      await route.fulfill({ contentType: 'image/svg+xml', body: LANDSCAPE })
    })
    await withCarouselRuntime(
      page,
      target,
      async () => {
        const carousel = page.getByRole('region', { name: 'Styled work', exact: true })
        const active = carousel.locator('[data-openpencil-carousel-slide][data-active]')
        const media = active.locator('[data-openpencil-carousel-media]')
        const copy = active.locator('[data-openpencil-carousel-copy]')
        const text = active.locator('[data-openpencil-carousel-text]')
        await expect(carousel).toHaveAttribute('data-layout', 'overlay')
        expect(requests).toEqual([])
        await expect(carousel.locator('img')).toHaveCount(0)
        await carousel.getByRole('button', { name: 'Load remote slide media', exact: true }).click()
        await expect(active.getByRole('img')).toBeVisible()
        await expect
          .poll(() =>
            active.getByRole('img').evaluate((image: HTMLImageElement) => image.naturalWidth)
          )
          .toBe(800)
        expect(new Set(requests)).toEqual(new Set(['https://media.example.com/style.png']))
        const bounds = await carousel.boundingBox()
        if (!bounds) throw new Error('Carousel bounds are missing')
        await expect(media).toHaveCSS('height', `${bounds.height}px`)
        await expect(media).toHaveCSS('width', `${bounds.width}px`)
        await page.getByRole('spinbutton', { name: 'Shade', exact: true }).fill('0.6')
        await expect
          .poll(() => active.evaluate((element) => getComputedStyle(element, '::before').opacity))
          .toBe('0.6')
        for (const fit of ['contain', 'fill', 'cover']) {
          await page.getByRole('combobox', { name: 'imageFit', exact: true }).selectOption(fit)
          await expect(active.getByRole('img')).toHaveCSS('object-fit', fit)
        }
        for (const [position, align, pagination] of [
          ['top', 'left', 'numbers'],
          ['center', 'center', 'fraction'],
          ['bottom', 'right', 'dots']
        ] as const) {
          await page
            .getByRole('combobox', { name: 'textPosition', exact: true })
            .selectOption(position)
          await page.getByRole('combobox', { name: 'textAlign', exact: true }).selectOption(align)
          await page
            .getByRole('combobox', { name: 'paginationStyle', exact: true })
            .selectOption(pagination)
          await expect(copy).toHaveCSS('text-align', align)
          await expect
            .poll(async () => {
              const value = await text.boundingBox()
              if (!value) return Number.POSITIVE_INFINITY
              let expected = bounds.y + 20
              if (position === 'center') expected += (bounds.height - 64 - value.height) / 2
              if (position === 'bottom') expected = bounds.y + bounds.height - 44 - value.height
              return Math.abs(value.y - expected)
            })
            .toBeLessThanOrEqual(1)
          const paginationHost = carousel.locator('[data-openpencil-carousel-dots]')
          await expect(paginationHost).toHaveAttribute('data-pagination', pagination)
          if (pagination === 'fraction') {
            await expect(paginationHost).toHaveText('1 / 12')
            await expect(paginationHost.getByRole('button')).toHaveCount(0)
          } else {
            await expect(paginationHost.getByRole('button')).toHaveCount(12)
          }
          await screenshot(page, target, `overlay-${position}-${pagination}`)
        }
        await page.getByRole('combobox', { name: 'layout', exact: true }).selectOption('split')
        await page.getByRole('combobox', { name: 'imageFit', exact: true }).selectOption('contain')
        await page.getByRole('combobox', { name: 'textAlign', exact: true }).selectOption('left')
        await expect
          .poll(async () => (await media.boundingBox())?.height)
          .toBeCloseTo(bounds.height * 0.58, 1)
        await expect(active.getByRole('img')).toHaveCSS('object-fit', 'contain')
        await screenshot(page, target, 'split-contain')
      },
      true
    )
  })

  test(`${target} carousel keeps twelve narrow pagination controls accessible and long overlay copy scrollable`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    await page.route('https://media.example.com/**', (route) =>
      route.fulfill({ contentType: 'image/svg+xml', body: LANDSCAPE })
    )
    await withCarouselRuntime(
      page,
      target,
      async () => {
        const carousel = page.getByRole('region', { name: 'Styled work', exact: true })
        await carousel.getByRole('button', { name: 'Load remote slide media', exact: true }).click()
        await page.getByRole('checkbox', { name: 'Compact', exact: true }).check()
        const pagination = carousel.getByRole('group', { name: 'Choose slide', exact: true })
        await carousel.focus()
        await carousel.press('End')
        const last = pagination.getByRole('button', {
          name: 'Show slide 12: Style 12',
          exact: true
        })
        await expect(last).toHaveAttribute('aria-current', 'true')
        await within(pagination, last)
        await expect
          .poll(() => pagination.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0)
        const next = carousel.getByRole('button', { name: 'Next slide', exact: true })
        await within(carousel, next)
        await next.click()
        const first = pagination.getByRole('button', { name: 'Show slide 1: Style 1', exact: true })
        await expect(first).toHaveAttribute('aria-current', 'true')
        await within(pagination, first)
        await pagination.getByRole('button', { name: 'Show slide 2: Style 2', exact: true }).click()
        await expect(carousel.locator('[data-active] h2')).toHaveText('Style 2')
        const copy = carousel.locator('[data-active] [data-openpencil-carousel-copy]')
        await expect
          .poll(() => copy.evaluate((element) => element.scrollHeight > element.clientHeight))
          .toBe(true)
        await copy.evaluate((element) => {
          element.scrollTop = 120
        })
        await expect.poll(() => copy.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
        await expect
          .poll(async () => {
            const host = await carousel.boundingBox(),
              content = await copy.boundingBox()
            return Boolean(
              host && content && content.y + content.height <= host.y + host.height + 1
            )
          })
          .toBe(true)
        await page
          .getByRole('combobox', { name: 'paginationStyle', exact: true })
          .selectOption('fraction')
        await expect(carousel.getByRole('group', { name: 'Slide pagination' })).toHaveText('2 / 12')
        await page.getByRole('checkbox', { name: 'Pagination', exact: true }).uncheck()
        await expect(carousel.locator('[data-openpencil-carousel-dots]')).toHaveCount(0)
        await page.getByRole('checkbox', { name: 'Pagination', exact: true }).check()
        await page.getByRole('checkbox', { name: 'Single slide', exact: true }).check()
        await expect(carousel.getByRole('group', { name: 'Slide pagination' })).toHaveText('1 / 1')
        await expect(next).toHaveCount(0)
        await page
          .getByRole('combobox', { name: 'paginationStyle', exact: true })
          .selectOption('numbers')
        await expect(
          carousel.getByRole('button', { name: 'Show slide 1: Style 1', exact: true })
        ).toHaveText('1')
        await page
          .getByRole('combobox', { name: 'paginationStyle', exact: true })
          .selectOption('dots')
        await expect(carousel.locator('[data-openpencil-carousel-dots]')).toHaveCount(0)
      },
      true
    )
  })

  test(`${target} nested split carousel keeps its own layout and controls inside an overlay carousel`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('https://media.example.com/**', (route) =>
      route.fulfill({ contentType: 'image/svg+xml', body: LANDSCAPE })
    )
    await withCarouselRuntime(
      page,
      target,
      async () => {
        await page.getByRole('checkbox', { name: 'Nested carousel', exact: true }).check()
        const outer = page.getByRole('region', { name: 'Styled work', exact: true })
        const inner = outer.getByRole('region', { name: 'Nested split', exact: true })
        const slide = inner.locator(':scope > [data-openpencil-carousel-track] > [data-active]')
        const media = slide.locator(':scope > [data-openpencil-carousel-media]')
        const copy = slide.locator(':scope > [data-openpencil-carousel-copy]')
        const pagination = inner.locator(':scope > [data-openpencil-carousel-dots]')
        await expect(outer).toHaveAttribute('data-layout', 'overlay')
        await expect(inner).toHaveAttribute('data-layout', 'split')
        await expect(inner).not.toHaveAttribute('data-autoplay')
        for (const layout of ['overlay', 'split', 'overlay']) {
          await page.getByRole('combobox', { name: 'layout', exact: true }).selectOption(layout)
          await expect(media).toHaveCSS('position', 'relative')
          await expect
            .poll(async () => (await media.boundingBox())?.height)
            .toBeCloseTo(220 * 0.58, 1)
          await expect(copy).toHaveCSS('display', 'block')
          await expect(copy).toHaveCSS('padding-top', '20px')
          await expect(copy.locator(':scope > [data-openpencil-carousel-text]')).toHaveCSS(
            'margin-top',
            '0px'
          )
          await expect
            .poll(() => slide.evaluate((element) => getComputedStyle(element, '::before').content))
            .toBe('none')
          await expect(pagination).toHaveCSS('left', '52px')
          await expect(pagination).toHaveCSS('right', '52px')
        }
        await inner.getByRole('button', { name: 'Load remote slide media', exact: true }).click()
        await expect(slide.getByRole('img')).toBeVisible()
        await expect(outer.locator(':scope > [data-openpencil-carousel-track] img')).toHaveCount(0)
        const next = inner.getByRole('button', { name: 'Next slide', exact: true })
        await expect(next).toHaveCSS('font-size', '24px')
        await next.click()
        await expect(slide.locator('h2')).toHaveText('Style 2')
        await expect(
          outer.locator(':scope > [data-openpencil-carousel-track] > [data-active] h2')
        ).toHaveText('Style 1')
        const first = pagination.getByRole('button', { name: 'Show slide 1: Style 1', exact: true })
        await expect(first).toHaveCSS('font-size', '12px')
        await first.click()
        await expect(first).toHaveAttribute('aria-current', 'true')
        await screenshot(page, target, 'nested-overlay-split')
      },
      true
    )
  })
}
