import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/** Read actual browser pixels away from glyphs and the rounded host corners. */
async function edgePixels(page: Page, item: Locator): Promise<number[][]> {
  const labelBounds = await item.locator('dt').boundingBox()
  if (!labelBounds) throw new Error('Descriptions label geometry is missing')
  const screenshot = await item.screenshot({ scale: 'css' })
  return page.evaluate(
    async ({ bytes, labelWidth }) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(bytes)], { type: 'image/png' })
      )
      try {
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas pixel reader is unavailable')
        context.drawImage(bitmap, 0, 0)
        const labelX = Math.floor(Math.min(bitmap.width / 4, labelWidth / 2))
        const valueX = Math.floor(bitmap.width * 0.8)
        return [
          [labelX, 0],
          [labelX, bitmap.height - 1],
          [valueX, 0],
          [valueX, bitmap.height - 1]
        ].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data])
      } finally {
        bitmap.close()
      }
    },
    { bytes: [...screenshot], labelWidth: labelBounds.width }
  )
}

/** Label backgrounds must not erase the complete cell border; border visibility is paint only. */
export async function expectDescriptionsBorders(page: Page, host: Locator): Promise<void> {
  const originalLayout = await host.getAttribute('data-layout')
  const originalBordered = await host.getAttribute('data-bordered')
  try {
    await host.evaluate((element) => {
      element.style.width = '320px'
    })
    for (const layout of ['horizontal', 'vertical']) {
      await host.evaluate((element, value) => {
        element.setAttribute('data-layout', value)
        element.setAttribute('data-bordered', 'true')
      }, layout)
      const item = host.locator('[data-description-item]').first()
      const borderedBounds = await item.boundingBox()
      if (!borderedBounds) throw new Error('Descriptions cell geometry is missing')
      for (const pixel of await edgePixels(page, item)) expect(pixel).toEqual([226, 232, 240, 255])
      await host.evaluate((element) => {
        element.setAttribute('data-bordered', 'false')
      })
      for (const pixel of await edgePixels(page, item)) expect(pixel).toEqual([255, 255, 255, 255])
      const plainBounds = await item.boundingBox()
      if (!plainBounds) throw new Error('Descriptions cell geometry is missing')
      expect(plainBounds).toEqual(borderedBounds)
    }
  } finally {
    await host.evaluate(
      (element, values) => {
        if (values.layout !== null) element.setAttribute('data-layout', values.layout)
        if (values.bordered !== null) element.setAttribute('data-bordered', values.bordered)
      },
      { layout: originalLayout, bordered: originalBordered }
    )
  }
}
