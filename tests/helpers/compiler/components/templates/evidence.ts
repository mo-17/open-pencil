import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { getComponentTemplates } from '@/app/lowcode/component-templates/catalog'

import type { TemplateId, TemplateTarget } from './fixture'
import { expectWalktourViewport } from './walktour-behavior'

export async function recordTemplateLayout(
  page: Page,
  info: TestInfo,
  id: TemplateId,
  target: TemplateTarget,
  locale: 'en' | 'zh-CN' = 'zh-CN',
  view?: 'dialog' | 'details' | 'active'
) {
  const gallery = resolve(
    process.env.OPENPENCIL_TEMPLATE_GALLERY_DIR ??
      'output/lowcode-template-library-20260922/gallery'
  )
  mkdirSync(gallery, { recursive: true })
  const suffix = (locale === 'en' ? '-en' : '') + (view ? '-' + view : '')
  const templateName = getComponentTemplates(locale).find((entry) => entry.id === id)?.name
  if (!templateName) throw new Error('Unknown template: ' + id)
  await expect(page.getByText(templateName, { exact: true }).first()).toBeVisible()
  const measurements = []
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => document.fonts.ready)
    if (id === 'walktour') await expectWalktourViewport(page, width)
    const measurement = await page.evaluate(() => {
      const controls = []
      for (const element of document.querySelectorAll<HTMLElement>(
        'button,input:not([type="file"]),select,textarea,[role="switch"],[role="tab"]'
      )) {
        if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden')
          continue
        const rect = element.getBoundingClientRect()
        let scroller: HTMLElement | null = element.parentElement
        while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX)) {
          scroller = scroller.parentElement
        }
        controls.push({
          tag: element.tagName,
          label: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 60),
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          horizontalScroller: Boolean(scroller && scroller.scrollWidth > scroller.clientWidth + 1)
        })
      }
      return {
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        controls
      }
    })
    expect(measurement.documentWidth, `${id}/${target}/${width} page overflow`).toBeLessThanOrEqual(
      width + 1
    )
    for (const control of measurement.controls.filter((control) => !control.horizontalScroller)) {
      expect(
        control.left,
        `${id}/${target}/${width} ${control.label} left edge`
      ).toBeGreaterThanOrEqual(-1)
      expect(
        control.right,
        `${id}/${target}/${width} ${control.label} right edge`
      ).toBeLessThanOrEqual(width + 1)
    }
    const paragraphs =
      locale === 'en'
        ? await page.locator('p').evaluateAll((elements) =>
            elements
              .filter((element) => element.getClientRects().length > 0)
              .map((element) => ({
                text: element.textContent,
                clientHeight: element.clientHeight,
                scrollHeight: element.scrollHeight
              }))
          )
        : []
    measurements.push({ ...measurement, paragraphs })
    const filename = `${id}-${target}-${width}${suffix}.png`
    await page.screenshot({ path: resolve(gallery, filename), fullPage: true })
    await info.attach(filename, { path: resolve(gallery, filename), contentType: 'image/png' })
    for (const paragraph of paragraphs) {
      expect
        .soft(
          paragraph.scrollHeight,
          `${id}/${target}/${width}/${locale} paragraph exceeds its text box: ${paragraph.text}`
        )
        .toBeLessThanOrEqual(paragraph.clientHeight + 1)
    }
  }
  const path = resolve(gallery, `${id}-${target}${suffix}-layout.json`)
  writeFileSync(path, JSON.stringify(measurements, null, 2))
  await info.attach(`${id}-${target}${suffix}-layout.json`, {
    path,
    contentType: 'application/json'
  })
}
