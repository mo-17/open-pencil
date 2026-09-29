import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test'

import { withCarouselRuntime } from '#tests/helpers/compiler/modules/carousel/browser'

const LANDSCAPE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#7dd3fc"/><circle cx="620" cy="80" r="44" fill="#fde047"/><path d="M0 320L190 90L400 360L600 160L800 350V400H0" fill="#0f766e"/><path d="M0 360L300 260L600 370L800 300V400H0" fill="#134e4a"/></svg>'

async function bounds(locator: Locator) {
  const result = await locator.boundingBox()
  if (!result) throw new Error('Expected visible carousel geometry')
  return result
}

function activeTitle(carousel: Locator) {
  return carousel.locator(':scope > [data-openpencil-carousel-track] > [data-active] h2')
}

async function localMedia(page: Page) {
  await page.route('https://media.example.com/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: LANDSCAPE })
  )
}

async function loadMedia(carousel: Locator) {
  await carousel.getByRole('button', { name: 'Load remote slide media', exact: true }).click()
  await expect(carousel).toBeFocused()
  await expect(
    carousel.locator(':scope > [data-openpencil-carousel-track] > [data-active] img')
  ).toBeVisible()
}

async function mouseDrag(page: Page, carousel: Locator, direction: -1 | 1, distance = 140) {
  const box = await bounds(carousel)
  const x = box.x + box.width / 2 - (direction * distance) / 2
  const y = box.y + 85
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + direction * distance, y + 2, { steps: 6 })
  await page.mouse.up()
}

async function touchDrag(session: CDPSession, carousel: Locator, dx: number, dy = 0) {
  const box = await bounds(carousel)
  const x = box.x + box.width / 2 - dx / 2,
    y = box.y + 130
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }]
  })
  for (let step = 1; step <= 5; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * step) / 5, y: y + (dy * step) / 5, id: 1 }]
    })
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function separated(first: Locator, second: Locator) {
  const a = await bounds(first),
    b = await bounds(second)
  expect(
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
  ).toBe(true)
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} carousel arrow positions reserve controls, content and pagination space`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await localMedia(page)
    await withCarouselRuntime(
      page,
      target,
      async () => {
        const carousel = page.getByRole('region', { name: 'Navigation carousel', exact: true })
        const previous = carousel.getByRole('button', { name: 'Previous slide', exact: true })
        const next = carousel.getByRole('button', { name: 'Next slide', exact: true })
        const position = page.getByRole('combobox', { name: 'Arrow position', exact: true })
        await position.selectOption('top-corners')
        await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('220')
        await page.getByRole('checkbox', { name: 'autoplay', exact: true }).check()
        const pause = carousel.getByRole('button', { name: 'Pause carousel', exact: true })
        const permission = carousel.getByRole('button', {
          name: 'Load remote slide media',
          exact: true
        })
        await separated(previous, pause)
        await separated(next, pause)
        await separated(next, permission)
        await separated(previous, permission)
        await pause.click()
        await carousel.getByRole('button', { name: 'Resume carousel', exact: true }).click()
        await loadMedia(carousel)
        await page.getByRole('checkbox', { name: 'autoplay', exact: true }).uncheck()
        await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('520')
        for (const [name, x1, x2, y, left, right] of [
          ['sides', 12, 476, 144, 12, 12],
          ['top-corners', 12, 476, 12, 12, 12],
          ['bottom-corners', 12, 476, 286, 52, 52],
          ['bottom-left', 12, 52, 286, 96, 12],
          ['bottom-right', 436, 476, 286, 12, 96]
        ] as const) {
          await position.selectOption(name)
          await expect(carousel).toHaveAttribute('data-arrow-position', name)
          const host = await bounds(carousel)
          const first = await bounds(previous),
            last = await bounds(next)
          expect(first.x - host.x).toBeCloseTo(x1, 1)
          expect(last.x - host.x).toBeCloseTo(x2, 1)
          expect(first.y - host.y).toBeCloseTo(y, 1)
          expect(last.y - host.y).toBeCloseTo(y, 1)
          const pagination = carousel.locator(':scope > [data-openpencil-carousel-dots]')
          await expect(pagination).toHaveCSS('left', `${left}px`)
          await expect(pagination).toHaveCSS('right', `${right}px`)
          await next.click()
          await expect(activeTitle(carousel)).toHaveText('Build')
          await previous.click()
          await expect(activeTitle(carousel)).toHaveText('Explore')
          await page.getByRole('button', { name: 'Outside focus', exact: true }).focus()
          await page.mouse.move(800, 600)
          await carousel.screenshot({
            path: test.info().outputPath(`${target}-${name}-component.png`),
            animations: 'disabled'
          })
        }
        await position.selectOption('sides')
        await page.getByRole('spinbutton', { name: 'Width', exact: true }).fill('120')
        await page.getByRole('spinbutton', { name: 'Height', exact: true }).fill('80')
        await separated(
          next,
          carousel.getByRole('button', { name: 'Show slide 3: Share', exact: true })
        )
        await separated(
          previous,
          carousel.getByRole('button', { name: 'Show slide 1: Explore', exact: true })
        )
        await expect(carousel.locator(':scope > [data-openpencil-carousel-arrows]')).toHaveCSS(
          'top',
          '12px'
        )
        await page.getByRole('checkbox', { name: 'showArrows', exact: true }).uncheck()
        await expect(next).toHaveCount(0)
        await expect(carousel.locator(':scope > [data-openpencil-carousel-dots]')).toHaveCSS(
          'left',
          '12px'
        )
      },
      'navigation'
    )
  })

  test(`${target} mouse dragging respects thresholds, controls, nested ownership and disabled boundaries`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await localMedia(page)
    await withCarouselRuntime(
      page,
      target,
      async () => {
        const carousel = page.getByRole('region', { name: 'Navigation carousel', exact: true })
        await loadMedia(carousel)
        const count = page.getByRole('status', { name: 'Click count', exact: true })
        const before = await count.textContent()
        await mouseDrag(page, carousel, -1, 12)
        await expect(activeTitle(carousel)).toHaveText('Explore')
        const afterTap = await count.textContent()
        await mouseDrag(page, carousel, -1)
        await expect(activeTitle(carousel)).toHaveText('Build')
        await expect(count).toHaveText(afterTap ?? before ?? '')
        await mouseDrag(page, carousel, 1)
        await expect(activeTitle(carousel)).toHaveText('Explore')
        await page.getByRole('checkbox', { name: 'loop', exact: true }).uncheck()
        await mouseDrag(page, carousel, 1)
        await expect(activeTitle(carousel)).toHaveText('Explore')
        await mouseDrag(page, carousel, -1)
        await mouseDrag(page, carousel, -1)
        await mouseDrag(page, carousel, -1)
        await expect(activeTitle(carousel)).toHaveText('Share')
        await expect(
          carousel.getByRole('button', { name: 'Next slide', exact: true })
        ).toBeDisabled()
        await page.getByRole('checkbox', { name: 'swipeEnabled', exact: true }).uncheck()
        await mouseDrag(page, carousel, 1)
        await expect(activeTitle(carousel)).toHaveText('Share')
        await page.getByRole('checkbox', { name: 'swipeEnabled', exact: true }).check()
        await page.getByRole('checkbox', { name: 'Nested', exact: true }).check()
        const nested = carousel.getByRole('region', { name: 'Nested navigation', exact: true })
        await loadMedia(nested)
        await mouseDrag(page, nested, -1, 90)
        await expect(activeTitle(nested)).toHaveText('Build')
        await expect(activeTitle(carousel)).toHaveText('Share')
        await page.getByRole('checkbox', { name: 'Nested', exact: true }).uncheck()
        await page.getByRole('checkbox', { name: 'Interactive content', exact: true }).check()
        const field = carousel.getByRole('textbox', { name: 'Carousel field', exact: true })
        await field.fill('Editable data')
        const editor = carousel.getByRole('textbox', { name: 'Inline editor', exact: true })
        await editor.fill('Editable text')
        for (const control of [
          field,
          editor,
          carousel.getByRole('link', { name: 'Local link', exact: true })
        ]) {
          const area = await bounds(control)
          await page.mouse.move(area.x + 2, area.y + area.height / 2)
          await page.mouse.down()
          await page.mouse.move(area.x + Math.max(60, area.width - 4), area.y + area.height / 2, {
            steps: 5
          })
          await page.mouse.up()
          await expect(activeTitle(carousel)).toHaveText('Share')
        }
        await carousel.getByRole('button', { name: 'Inner action', exact: true }).click()
        await expect(activeTitle(carousel)).toHaveText('Share')
        await page.getByRole('checkbox', { name: 'Interactive content', exact: true }).uncheck()
        await expect(carousel).toHaveAttribute('data-swipe', 'true')
        const heading = await bounds(activeTitle(carousel))
        await page.mouse.move(heading.x + 1, heading.y + 12)
        await page.mouse.down()
        await page.mouse.move(heading.x + 80, heading.y + 12, { steps: 8 })
        await page.mouse.up()
        await expect
          .poll(() => page.evaluate(() => getSelection()?.toString().length ?? 0))
          .toBeGreaterThan(0)
        await expect(activeTitle(carousel)).toHaveText('Share')
        await page.getByRole('checkbox', { name: 'Single', exact: true }).check()
        await expect(carousel).not.toHaveAttribute('data-swipe')
        await mouseDrag(page, carousel, -1)
        await expect(activeTitle(carousel)).toHaveText('Explore')
      },
      'navigation'
    )
  })

  test(`${target} emulated touch swipes preserve vertical scroll and cancel safely for multiple pointers`, async ({
    page,
    context
  }) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await localMedia(page)
    await withCarouselRuntime(
      page,
      target,
      async () => {
        const carousel = page.getByRole('region', { name: 'Navigation carousel', exact: true })
        await loadMedia(carousel)
        const session = await context.newCDPSession(page)
        try {
          await session.send('Emulation.setTouchEmulationEnabled', {
            enabled: true,
            maxTouchPoints: 2
          })
          await touchDrag(session, carousel, -150)
          await expect(activeTitle(carousel)).toHaveText('Build')
          await touchDrag(session, carousel, 150)
          await expect(activeTitle(carousel)).toHaveText('Explore')
          const box = await bounds(carousel)
          const point = { x: box.x + 250, y: box.y + 100, id: 1 }
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [point]
          })
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ ...point, x: point.x - 80 }]
          })
          await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
          await expect(activeTitle(carousel)).toHaveText('Explore')
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [point]
          })
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [point, { ...point, x: point.x + 40, id: 2 }]
          })
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              { ...point, x: point.x - 100 },
              { ...point, x: point.x - 60, id: 2 }
            ]
          })
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await expect(activeTitle(carousel)).toHaveText('Explore')
          await touchDrag(session, carousel, 3, -120)
          await expect(activeTitle(carousel)).toHaveText('Explore')
          await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
        } finally {
          await session.detach()
        }
      },
      'navigation'
    )
  })

  test(`${target} autoplay pauses during a held gesture and releases state on disable and unmount`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    await page.clock.install()
    await localMedia(page)
    await withCarouselRuntime(
      page,
      target,
      async () => {
        const carousel = page.getByRole('region', { name: 'Navigation carousel', exact: true })
        const outside = page.getByRole('button', { name: 'Outside focus', exact: true })
        await loadMedia(carousel)
        await page.getByRole('checkbox', { name: 'autoplay', exact: true }).check()
        await outside.focus()
        await page.mouse.move(800, 600)
        await page.clock.fastForward(2100)
        await expect(activeTitle(carousel)).toHaveText('Build')
        const box = await bounds(carousel)
        await page.mouse.move(box.x + 330, box.y + 85)
        await page.mouse.down()
        await outside.focus()
        await page.clock.fastForward(4500)
        await expect(activeTitle(carousel)).toHaveText('Build')
        await page.mouse.move(box.x + 190, box.y + 85, { steps: 5 })
        await page.mouse.up()
        await expect(activeTitle(carousel)).toHaveText('Share')
        await page.clock.fastForward(2100)
        await expect(activeTitle(carousel)).toHaveText('Explore')
        await page.mouse.move(box.x + 330, box.y + 85)
        await page.mouse.down()
        await page.getByRole('checkbox', { name: 'swipeEnabled', exact: true }).focus()
        await page.keyboard.press('Space')
        await outside.focus()
        await page.mouse.move(box.x + 190, box.y + 85, { steps: 5 })
        await page.mouse.up()
        await expect(activeTitle(carousel)).toHaveText('Explore')
        await page.clock.fastForward(2100)
        await expect(activeTitle(carousel)).toHaveText('Build')
        await page.getByRole('checkbox', { name: 'swipeEnabled', exact: true }).check()
        await page.mouse.move(box.x + 330, box.y + 85)
        await page.mouse.down()
        await page.getByRole('checkbox', { name: 'Mounted', exact: true }).focus()
        await page.keyboard.press('Space')
        await expect(carousel).toHaveCount(0)
        await page.clock.fastForward(4500)
        await page.keyboard.press('Space')
        await outside.focus()
        await page.mouse.up()
        await expect(activeTitle(carousel)).toHaveText('Explore')
        await page.clock.fastForward(2100)
        await expect(activeTitle(carousel)).toHaveText('Build')
      },
      'navigation'
    )
  })
}
