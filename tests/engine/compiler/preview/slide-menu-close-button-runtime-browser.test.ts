import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import {
  createSlideMenuModuleInstance,
  SLIDE_MENU_MODULE_DEFAULT_CONFIG
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function buildSlideMenuFiles(
  title = 'A deliberately long navigation title that must never sit beneath the close control',
  description = 'This longer description verifies that the header copy keeps a safe column beside the close control.'
) {
  const compiledTitle = title || 'Placeholder title'
  const compiledDescription = description || 'Placeholder description'
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.createNode('FRAME', pageId, {
    x: 40,
    y: 40,
    width: 180,
    height: 48,
    interactiveProps: {
      module: createSlideMenuModuleInstance({
        ...SLIDE_MENU_MODULE_DEFAULT_CONFIG,
        title: compiledTitle,
        description: compiledDescription,
        items: [{ label: 'Destination', href: '#destination' }]
      })
    }
  })
  const files = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'slide-menu-close-button-browser', devMode: false })
  }).files
  if (!title || !description) {
    const app = files.get('src/App.tsx') as string
    files.set(
      'src/App.tsx',
      app
        .replace(`"title":${JSON.stringify(compiledTitle)}`, `"title":${JSON.stringify(title)}`)
        .replace(
          `"description":${JSON.stringify(compiledDescription)}`,
          `"description":${JSON.stringify(description)}`
        )
    )
  }
  return files
}

describe('preview browser — Slide Menu close button', () => {
  const timeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({ initialFiles: buildSlideMenuFiles() })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 })
    await page.goto(server.url, { waitUntil: 'networkidle' })
  }, timeoutMs)

  afterEach(async () => {
    try {
      await page?.close()
    } finally {
      try {
        await browser?.close()
      } finally {
        await server?.close()
      }
    }
  }, timeoutMs)

  test(
    'keeps a vector X in a 44px top-right target without covering panel content',
    async () => {
      if (!page || !server) throw new Error('Missing Slide Menu preview runtime')
      const trigger = page.locator('[data-openpencil-slide-menu-trigger]')
      await trigger.focus()
      await trigger.press('Enter')
      const panel = page.locator('[data-openpencil-slide-menu-panel]')
      await playwrightExpect(panel).toHaveAttribute('data-state', 'open')
      const closeButton = page.getByRole('button', { name: 'Close' })
      await playwrightExpect(closeButton).toBeFocused()

      const metrics = await closeButton.evaluate((element) => {
        const button = element as HTMLButtonElement
        const panelNode = button.closest<HTMLElement>('[data-openpencil-slide-menu-panel]')
        const copyNode = button.previousElementSibling as HTMLElement | null
        const navNode = panelNode?.querySelector<HTMLElement>('nav')
        const icon = button.querySelector<SVGElement>('[data-openpencil-slide-menu-close-icon]')
        const path = icon?.querySelector('path')
        if (!panelNode || !copyNode || !navNode || !icon || !path) {
          throw new Error('Missing close-button layout element')
        }
        const buttonRect = button.getBoundingClientRect()
        const panelRect = panelNode.getBoundingClientRect()
        const copyRect = copyNode.getBoundingClientRect()
        const navRect = navNode.getBoundingClientRect()
        const focusStyle = getComputedStyle(button)
        return {
          ariaHidden: icon.getAttribute('aria-hidden'),
          copyGap: buttonRect.left - copyRect.right,
          focusable: icon.getAttribute('focusable'),
          focusOutlineStyle: focusStyle.outlineStyle,
          focusOutlineWidth: Number.parseFloat(focusStyle.outlineWidth),
          height: buttonRect.height,
          iconTag: icon.tagName,
          navGap: navRect.top - Math.max(buttonRect.bottom, copyRect.bottom),
          path: path.getAttribute('d'),
          rightInset: panelRect.right - buttonRect.right,
          text: button.textContent,
          topInset: buttonRect.top - panelRect.top,
          viewBox: icon.getAttribute('viewBox'),
          width: buttonRect.width
        }
      })

      expect(metrics).toMatchObject({
        ariaHidden: 'true',
        focusable: 'false',
        height: 44,
        iconTag: 'svg',
        path: 'M6 6L18 18M18 6L6 18',
        text: '',
        viewBox: '0 0 24 24',
        width: 44
      })
      expect(metrics.copyGap).toBeCloseTo(16, 3)
      expect(metrics.navGap).toBeGreaterThanOrEqual(16)
      expect(metrics.rightInset).toBeCloseTo(24, 3)
      expect(metrics.topInset).toBeCloseTo(24, 3)
      expect(metrics.focusOutlineStyle).not.toBe('none')
      expect(metrics.focusOutlineWidth).toBeGreaterThan(0)

      await closeButton.press('Enter')
      await page.locator('[data-openpencil-slide-menu-overlay]').waitFor({ state: 'detached' })
      await playwrightExpect(trigger).toBeFocused()

      server.updateFiles(buildSlideMenuFiles('', ''))
      await page.goto(server.url, { waitUntil: 'networkidle' })
      await page.locator('[data-openpencil-slide-menu-trigger]').click()
      const noCopyClose = page.getByRole('button', { name: 'Close' })
      const noCopyMetrics = await noCopyClose.evaluate((element) => {
        const buttonRect = element.getBoundingClientRect()
        const panelNode = element.closest<HTMLElement>('[data-openpencil-slide-menu-panel]')
        if (!panelNode) throw new Error('Missing no-copy Slide Menu panel')
        const panelRect = panelNode.getBoundingClientRect()
        return {
          height: buttonRect.height,
          rightInset: panelRect.right - buttonRect.right,
          topInset: buttonRect.top - panelRect.top,
          width: buttonRect.width
        }
      })
      expect(noCopyMetrics).toEqual({ height: 44, rightInset: 24, topInset: 24, width: 44 })
      await noCopyClose.press('Enter')
      await page.locator('[data-openpencil-slide-menu-overlay]').waitFor({ state: 'detached' })
    },
    timeoutMs
  )
})
