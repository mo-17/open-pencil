import { expect, test, type Locator, type Page } from '@playwright/test'

import { withCarouselRuntime } from '#tests/helpers/compiler/modules/carousel/browser'

async function activeSlide(carousel: Locator, title: string) {
  await expect(carousel.locator('[data-openpencil-carousel-slide][data-active]')).toContainText(
    title
  )
}

async function watchCarouselTimers(page: Page) {
  return page.evaluateHandle(() => {
    const timers = new Set<number>()
    const originalSet = window.setInterval
    const originalClear = window.clearInterval
    const set: Window['setInterval'] = originalSet.bind(window)
    const clear: Window['clearInterval'] = originalClear.bind(window)
    Object.defineProperty(window, 'setInterval', {
      configurable: true,
      writable: true,
      value: (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        const id = set(handler, delay, ...args)
        if (delay === 2000) timers.add(id)
        return id
      }
    })
    Object.defineProperty(window, 'clearInterval', {
      configurable: true,
      writable: true,
      value: (id?: number) => {
        if (id !== undefined) timers.delete(id)
        clear(id)
      }
    })
    return {
      timers,
      restore() {
        Object.defineProperty(window, 'setInterval', {
          configurable: true,
          writable: true,
          value: originalSet
        })
        Object.defineProperty(window, 'clearInterval', {
          configurable: true,
          writable: true,
          value: originalClear
        })
      }
    }
  })
}

async function timerCount(watcher: Awaited<ReturnType<typeof watchCarouselTimers>>) {
  return watcher.evaluate((state) => state.timers.size)
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} carousel controls remain inside authored bounds and gate remote images by URL`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    const requests: string[] = []
    await page.route('https://media.example.com/**', async (route) => {
      requests.push(route.request().url())
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="520" height="180"><rect width="520" height="180" fill="#bfdbfe"/></svg>'
      })
    })
    await withCarouselRuntime(page, target, async () => {
      const carousel = page.getByRole('region', { name: 'Featured work', exact: true })
      const next = carousel.getByRole('button', { name: 'Next slide', exact: true })
      const previous = carousel.getByRole('button', { name: 'Previous slide', exact: true })
      await expect(carousel).toHaveCSS('position', 'absolute')
      await activeSlide(carousel, 'First slide')
      expect(requests).toEqual([])
      await expect(carousel.locator('img')).toHaveCount(0)
      const outer = await carousel.boundingBox()
      const control = await next.boundingBox()
      if (!outer || !control) throw new Error('Carousel geometry is missing')
      expect(control.y).toBeGreaterThanOrEqual(outer.y)
      expect(control.y + control.height).toBeLessThanOrEqual(outer.y + outer.height)
      await carousel.getByRole('button', { name: 'Load remote slide media', exact: true }).click()
      await expect(carousel.getByRole('img', { name: 'First preview' })).toBeVisible()
      await expect.poll(() => requests.length).toBe(1)
      await next.click()
      await activeSlide(carousel, 'Second slide')
      await expect(carousel).toContainText('<script>plain text</script>')
      const copy = carousel.locator('[data-active] [data-openpencil-carousel-copy]')
      const copyBounds = await copy.boundingBox()
      if (!copyBounds) throw new Error('Carousel description is missing')
      expect(copyBounds.y + copyBounds.height).toBeLessThanOrEqual(outer.y + outer.height + 1)
      await expect
        .poll(() => copy.evaluate((element) => element.scrollHeight > element.clientHeight))
        .toBe(true)
      await copy.evaluate((element) => {
        element.scrollTop = 100
      })
      await expect.poll(() => copy.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

      expect(requests).toHaveLength(1)
      await carousel.getByRole('button', { name: 'Load remote slide media', exact: true }).click()
      await expect.poll(() => requests.length).toBe(2)
      await expect(carousel.getByRole('img', { name: 'Second preview' })).toBeVisible()
      await expect(carousel.getByRole('link', { name: 'First slide' })).toHaveCount(0)
      await expect(
        carousel.locator('[data-openpencil-carousel-slide][aria-hidden=true]').first()
      ).toHaveAttribute('inert', '')
      await page.getByRole('button', { name: 'Rerender 0', exact: true }).click()
      await activeSlide(carousel, 'Second slide')
      await previous.click()
      await activeSlide(carousel, 'First slide')
      await previous.click()
      await activeSlide(carousel, 'Third slide')
      await carousel
        .getByRole('button', { name: 'Show slide 2: Second slide', exact: true })
        .click()
      await activeSlide(carousel, 'Second slide')
      await carousel.focus()
      await carousel.press('End')
      await activeSlide(carousel, 'Third slide')
      await carousel.press('Home')
      await activeSlide(carousel, 'First slide')
      await carousel.press('ArrowRight')
      await activeSlide(carousel, 'Second slide')
      await expect(carousel.locator('a button, button a')).toHaveCount(0)
      await carousel.getByRole('button', { name: 'Show slide 1: First slide', exact: true }).click()
      await activeSlide(carousel, 'First slide')
      const firstSlide = carousel.locator('[data-openpencil-carousel-slide][data-active]')
      await expect
        .poll(async () => {
          const bounds = await firstSlide.boundingBox()
          return bounds ? Math.abs(bounds.x - outer.x) : Number.POSITIVE_INFINITY
        })
        .toBeLessThan(0.5)
      await expect(
        firstSlide.getByRole('link', { name: 'First slide', exact: true })
      ).toBeInViewport()
      await expect
        .poll(() =>
          firstSlide
            .locator('[data-openpencil-carousel-copy]')
            .evaluate((element) => element.scrollTop)
        )
        .toBe(0)
      await page.getByRole('button', { name: 'Outside focus', exact: true }).focus()
      await page.mouse.move(700, 500)
      await page.screenshot({
        path: test.info().outputPath(target + '-carousel-runtime.png'),
        animations: 'disabled'
      })
    })
  })

  test(`${target} carousel autoplay pauses for hover and focus, stops at non-loop end and releases timers`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    await page.clock.install()
    await withCarouselRuntime(page, target, async () => {
      const watcher = await watchCarouselTimers(page)
      try {
        const carousel = page.getByRole('region', { name: 'Featured work', exact: true })
        const outside = page.getByRole('button', { name: 'Outside focus', exact: true })
        await page.getByRole('checkbox', { name: 'Autoplay', exact: true }).check()
        await outside.focus()
        await page.mouse.move(700, 500)
        await expect.poll(() => timerCount(watcher)).toBe(1)
        await page.clock.fastForward(2100)
        await activeSlide(carousel, 'Second slide')
        await carousel.hover()
        await expect.poll(() => timerCount(watcher)).toBe(0)
        await page.clock.fastForward(4500)
        await activeSlide(carousel, 'Second slide')
        await page.mouse.move(700, 500)
        await carousel.getByRole('link', { name: 'Second slide', exact: true }).focus()
        await expect.poll(() => timerCount(watcher)).toBe(0)
        await page.clock.fastForward(4500)
        await activeSlide(carousel, 'Second slide')
        await outside.focus()
        await expect.poll(() => timerCount(watcher)).toBe(1)
        await page.clock.fastForward(2100)
        await activeSlide(carousel, 'Third slide')
        await page.getByRole('checkbox', { name: 'Loop', exact: true }).uncheck()
        await expect.poll(() => timerCount(watcher)).toBe(0)
        await page.clock.fastForward(4500)
        await activeSlide(carousel, 'Third slide')
        await expect(
          carousel.getByRole('button', { name: 'Next slide', exact: true })
        ).toBeDisabled()
        await page.getByRole('checkbox', { name: 'Loop', exact: true }).check()
        await expect.poll(() => timerCount(watcher)).toBe(1)
        await page.getByRole('checkbox', { name: 'Show carousel', exact: true }).uncheck()
        await expect(carousel).toHaveCount(0)
        await expect.poll(() => timerCount(watcher)).toBe(0)
      } finally {
        await watcher.evaluate((state) => state.restore())
        await watcher.dispose()
      }
    })
  })

  test(`${target} carousel respects reduced motion and explicit pause without losing manual navigation`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.install()
    await withCarouselRuntime(page, target, async () => {
      const watcher = await watchCarouselTimers(page)
      try {
        const carousel = page.getByRole('region', { name: 'Featured work', exact: true })
        const outside = page.getByRole('button', { name: 'Outside focus', exact: true })
        await page.getByRole('checkbox', { name: 'Autoplay', exact: true }).check()
        await outside.focus()
        await expect.poll(() => timerCount(watcher)).toBe(0)
        await page.clock.fastForward(4500)
        await activeSlide(carousel, 'First slide')
        await carousel.getByRole('button', { name: 'Next slide', exact: true }).click()
        await activeSlide(carousel, 'Second slide')
        await expect(carousel.locator('[data-active]')).toHaveCSS('transition-duration', '0s')
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await outside.focus()
        await page.mouse.move(700, 500)
        await expect.poll(() => timerCount(watcher)).toBe(1)
        await carousel.getByRole('button', { name: 'Pause carousel', exact: true }).click()
        await outside.focus()
        await page.mouse.move(700, 500)
        await expect.poll(() => timerCount(watcher)).toBe(0)
        await page.clock.fastForward(4500)
        await activeSlide(carousel, 'Second slide')
        await carousel.getByRole('button', { name: 'Resume carousel', exact: true }).click()
        await outside.focus()
        await page.mouse.move(700, 500)
        await expect.poll(() => timerCount(watcher)).toBe(1)
        await page.clock.fastForward(2100)
        await activeSlide(carousel, 'Third slide')
      } finally {
        await watcher.evaluate((state) => state.restore())
        await watcher.dispose()
      }
    })
  })
}
