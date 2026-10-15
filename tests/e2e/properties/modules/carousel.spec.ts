import type { Locator, Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

const PLUGIN_ID = 'open-pencil.carousel'

/** Begin a normal inspector interaction before committing its native select value. */
async function selectCarouselOption(control: Locator, value: string) {
  await control.blur()
  await control.focus()
  await control.selectOption(value)
}

async function insertCarousel(page: Page, renderer: 'retained' | 'tiled') {
  await page.goto(`/?test&renderer=${renderer}`)
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await page.getByTestId('settings-plugins-view').getByText('Browse', { exact: true }).click()
  await page.getByTestId('plugin-discover-search').fill('Carousel')
  await page.getByTestId(`plugin-install-${PLUGIN_ID}`).click()
  await expect(page.getByTestId(`plugin-installed-${PLUGIN_ID}`)).toBeVisible()
  await page.getByTestId(`plugin-enabled-${PLUGIN_ID}`).click()
  await expect(page.getByTestId(`plugin-enabled-${PLUGIN_ID}`)).toBeChecked()
  await page.getByTestId('app-settings-done').click()
  await page.getByTestId('toolbar-plugin-modules').click()
  await page.getByTestId(`toolbar-plugin-module-${PLUGIN_ID}-carousel`).click()
  await expect(page.getByTestId('carousel-slide-row')).toHaveCount(3)
  return canvas
}

async function expectCarouselPaint(canvas: CanvasHelper, color = [17, 24, 39]) {
  await expect
    .poll(
      async () => {
        const screenshot = await canvas.screenshotCanvas()
        return canvas.page.evaluate(
          async ({ bytes, color }) => {
            const bitmap = await createImageBitmap(
              new Blob([new Uint8Array(bytes)], { type: 'image/png' })
            )
            const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
            const context = surface.getContext('2d')
            if (!context) throw new Error('Pixel reader unavailable')
            context.drawImage(bitmap, 0, 0)
            bitmap.close()
            const { data } = context.getImageData(0, 0, surface.width, surface.height)
            let pixels = 0
            for (let index = 0; index < data.length; index += 4) {
              if (
                data[index] === color[0] &&
                data[index + 1] === color[1] &&
                data[index + 2] === color[2]
              )
                pixels++
            }
            return pixels
          },
          { bytes: Array.from(screenshot), color }
        )
      },
      {
        message: 'The inserted Carousel must paint its dark content, not only a selection outline',
        timeout: 15_000
      }
    )
    .toBeGreaterThan(30_000)
}

async function expectCarouselArrowPaint(canvas: CanvasHelper, position: 'sides' | 'bottom-right') {
  await expect
    .poll(
      async () => {
        const screenshot = await canvas.screenshotCanvas()
        return canvas.page.evaluate(
          async ({ bytes, position }) => {
            const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
            const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
            const context = surface.getContext('2d')
            if (!context) throw new Error('Pixel reader unavailable')
            context.drawImage(bitmap, 0, 0)
            bitmap.close()
            const { data } = context.getImageData(0, 0, surface.width, surface.height)
            let left = surface.width,
              top = surface.height,
              right = 0,
              bottom = 0
            for (let y = 0; y < surface.height; y++) {
              for (let x = 0; x < surface.width; x++) {
                const index = (y * surface.width + x) * 4
                if (data[index] !== 17 || data[index + 1] !== 24 || data[index + 2] !== 39) continue
                left = Math.min(left, x)
                right = Math.max(right, x)
                top = Math.min(top, y)
                bottom = Math.max(bottom, y)
              }
            }
            const scale = (right - left) / 640
            const cx = position === 'sides' ? left + 28 * scale : right - 68 * scale
            const cy = position === 'sides' ? (top + bottom) / 2 : bottom - 18 * scale
            let pixels = 0
            for (let y = Math.round(cy - 8 * scale); y < cy + 8 * scale; y++) {
              for (let x = Math.round(cx - 8 * scale); x < cx + 8 * scale; x++) {
                const index = (y * surface.width + x) * 4
                if (
                  data[index] >= 38 &&
                  data[index] <= 45 &&
                  data[index + 1] >= 44 &&
                  data[index + 1] <= 51 &&
                  data[index + 2] >= 58 &&
                  data[index + 2] <= 65
                )
                  pixels++
              }
            }
            return pixels / (scale * scale)
          },
          { bytes: Array.from(screenshot), position }
        )
      },
      {
        timeout: 15_000,
        message:
          'The canvas must repaint arrows at the selected position before capturing a baseline'
      }
    )
    .toBeGreaterThan(150)
}

test.use({ viewport: { width: 1600, height: 1100 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: install Carousel and edit individual slides with reorder, validation and undo`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const canvas = await insertCarousel(page, renderer)
    await expectCarouselPaint(canvas)
    const rows = page.getByTestId('carousel-slide-row')
    const firstTitle = rows.nth(0).getByTestId('carousel-slide-title')
    await firstTitle.fill('Featured collection')
    await firstTitle.blur()
    await expect(firstTitle).toHaveValue('Featured collection')
    const firstDescription = rows.nth(0).getByTestId('carousel-slide-description')
    await firstDescription.fill('Explore the latest designs.\nEach slide can be edited here.')
    await firstDescription.blur()

    await rows.nth(0).getByTestId('carousel-move-down').click()
    await expect(rows.nth(1).getByTestId('carousel-slide-title')).toHaveValue('Featured collection')
    await expect(page.getByTestId('carousel-initial-slide')).toContainText('Featured collection')
    await rows.nth(0).getByTestId('carousel-remove-slide').click()
    await expect(rows).toHaveCount(2)
    await expect(firstTitle).toHaveValue('Featured collection')
    await expect(page.getByTestId('carousel-initial-slide')).toContainText('Featured collection')

    const image = rows.nth(0).getByTestId('carousel-slide-imageUrl')
    await image.fill('http://localhost/private.png')
    await image.blur()
    await expect(page.getByTestId('carousel-draft-error')).toBeVisible()
    await expect(image).toHaveValue('http://localhost/private.png')
    await page.getByTestId('carousel-restore').click()
    await expect(image).toHaveValue('')
    await expect(page.getByTestId('carousel-draft-error')).toHaveCount(0)

    await image.fill('https://media.example.com/collection.webp')
    await image.blur()
    await expect(page.getByTestId('carousel-draft-error')).toBeVisible()
    const alt = rows.nth(0).getByTestId('carousel-slide-alt')
    await alt.fill('Featured design collection')
    await alt.blur()
    await expect(page.getByTestId('carousel-draft-error')).toHaveCount(0)
    await expect(image).toHaveValue('https://media.example.com/collection.webp')

    await page.getByTestId('carousel-add-slide').click()
    await expect(rows).toHaveCount(3)
    await rows.nth(2).getByTestId('carousel-slide-title').fill('New announcement')
    await rows.nth(2).getByTestId('carousel-slide-title').blur()
    await rows.nth(2).getByTestId('carousel-remove-slide').click()
    await expect(rows).toHaveCount(2)
    await canvas.undo()
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(2).getByTestId('carousel-slide-title')).toHaveValue('New announcement')
    await canvas.redo()
    await expect(rows).toHaveCount(2)
    await expectCarouselPaint(canvas, [31, 38, 52])
    await rows.nth(0).getByTestId('carousel-slide-title').scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`${renderer}-carousel-editor.png`) })
    canvas.assertNoErrors()
  })

  test(`${renderer}: style Carousel through the inspector and restore hidden options with undo`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const canvas = await insertCarousel(page, renderer)
    await expectCarouselPaint(canvas)
    const layout = page.getByRole('combobox', { name: 'Layout', exact: true })
    const position = page.getByRole('combobox', { name: 'Text position', exact: true })
    const pagination = page.getByRole('combobox', { name: 'Pagination style', exact: true })
    await expect(layout).toHaveValue('split')
    await expect(position).toHaveCount(0)
    await selectCarouselOption(layout, 'overlay')
    await selectCarouselOption(position, 'top')
    await selectCarouselOption(
      page.getByRole('combobox', { name: 'Text alignment', exact: true }),
      'center'
    )
    await selectCarouselOption(
      page.getByRole('combobox', { name: 'Image fit', exact: true }),
      'contain'
    )
    await selectCarouselOption(pagination, 'numbers')
    await pagination.blur()
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    await expect(pagination).toHaveValue('dots')
    await canvas.redo()
    await expect(pagination).toHaveValue('numbers')

    const showPagination = page.getByRole('checkbox', { name: 'Show pagination', exact: true })
    await showPagination.uncheck()
    await expect(pagination).toHaveCount(0)
    await showPagination.check()
    await expect(pagination).toHaveValue('numbers')
    await selectCarouselOption(layout, 'split')
    await expect(position).toHaveCount(0)
    await expectCarouselPaint(canvas)
    await selectCarouselOption(layout, 'overlay')
    await expect(position).toHaveValue('top')
    await expectCarouselPaint(canvas, [9, 13, 21])
    await layout.scrollIntoViewIfNeeded()
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-carousel-overlay-numbers.png`)
    await page.screenshot({ path: info.outputPath(`${renderer}-carousel-style-editor.png`) })
    await selectCarouselOption(pagination, 'fraction')
    await expect(pagination).toHaveValue('fraction')
    await pagination.blur()
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    await expect(pagination).toHaveValue('numbers')
    canvas.assertNoErrors()
  })

  test(`${renderer}: configure Carousel arrows, autoplay and swipe without losing hidden choices`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const canvas = await insertCarousel(page, renderer)
    await expectCarouselPaint(canvas)
    const position = page.getByRole('combobox', { name: 'Arrow position', exact: true })
    const arrows = page.getByRole('checkbox', { name: 'Show arrows', exact: true })
    const swipe = page.getByRole('checkbox', { name: 'Drag or swipe to switch', exact: true })
    await expect(position).toHaveValue('bottom-corners')
    await expect(swipe).toBeChecked()
    await selectCarouselOption(position, 'sides')
    await position.blur()
    await page.mouse.move(1550, 500)
    await expectCarouselArrowPaint(canvas, 'sides')
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-carousel-side-arrows.png`)
    await arrows.uncheck()
    await expect(position).toHaveCount(0)
    await arrows.check()
    await expect(position).toHaveValue('sides')
    for (const value of ['top-corners', 'bottom-corners', 'bottom-left', 'bottom-right']) {
      await selectCarouselOption(position, value)
      await expect(position).toHaveValue(value)
    }
    await position.blur()
    await expectCarouselArrowPaint(canvas, 'bottom-right')
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-carousel-grouped-arrows.png`)
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    await expect(position).toHaveValue('bottom-left')
    await canvas.redo()
    await expect(position).toHaveValue('bottom-right')
    await swipe.uncheck()
    await expect(swipe).not.toBeChecked()
    const autoplay = page.getByRole('checkbox', { name: 'Autoplay', exact: true })
    const interval = page.getByRole('spinbutton', { name: 'Autoplay interval (ms)', exact: true })
    await expect(interval).toHaveCount(0)
    await autoplay.check()
    await expect(interval).toHaveAttribute('aria-valuenow', '5000')
    await interval.click()
    await interval.fill('3000')
    await interval.press('Enter')
    await autoplay.uncheck()
    await expect(interval).toHaveCount(0)
    await autoplay.check()
    await expect(interval).toHaveAttribute('aria-valuenow', '3000')
    await position.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`${renderer}-carousel-navigation-editor.png`) })
    canvas.assertNoErrors()
  })
}
