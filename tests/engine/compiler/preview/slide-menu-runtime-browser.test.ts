import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import {
  createSlideMenuModuleFrameOverrides,
  createSlideMenuModuleInstance
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

type SlideMenuPresentation = 'menu' | 'dialog'
type SlideMenuDirection = 'left' | 'right' | 'top' | 'bottom'
const BASE_CONFIG = {
  presentation: 'menu' as SlideMenuPresentation,
  direction: 'left' as SlideMenuDirection,
  triggerLabel: 'Open navigation',
  title: 'Navigation',
  description: 'Choose a destination.',
  items: [
    { label: 'First destination', href: '#first' },
    { label: 'Last destination', href: '#last' }
  ],
  closeOnBackdrop: true,
  showCloseButton: true,
  panelSize: 320,
  panelBackground: '#FFFFFF',
  textColor: '#111827',
  overlayOpacity: 0.45
}

type SlideMenuConfigOverrides = Partial<typeof BASE_CONFIG> & {
  showTriggerIcon?: boolean
  showTriggerLabel?: boolean
}
function buildSlideMenuFiles(
  overrides: SlideMenuConfigOverrides = {},
  instanceCount = 1,
  includeAuthoredTrigger = true,
  useDefaultFrameOverrides = false
) {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  for (let index = 0; index < instanceCount; index += 1) {
    const config = {
      ...BASE_CONFIG,
      ...overrides,
      triggerLabel: `${overrides.triggerLabel ?? BASE_CONFIG.triggerLabel} ${index + 1}`
    }
    const frame = graph.createNode(
      'FRAME',
      pageId,
      useDefaultFrameOverrides
        ? {
            ...createSlideMenuModuleFrameOverrides(config),
            x: 40,
            y: 40 + index * 88
          }
        : {
            name: `Slide menu trigger ${index + 1}`,
            x: 40,
            y: 40 + index * 88,
            width: 240,
            height: 64,
            fills: [
              { type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: true }
            ],
            interactiveProps: {
              module: createSlideMenuModuleInstance(config)
            }
          }
    )
    if (includeAuthoredTrigger) {
      graph.createNode('BUTTON', frame.id, {
        height: 40,
        interactiveProps: { text: `Authored trigger ${index + 1}` },
        width: 180,
        x: 12,
        y: 12
      })
    }
  }
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'slide-menu-runtime-browser', devMode: false })
  }).files
}
async function loadFixture(
  server: PreviewServer,
  page: Page,
  overrides: SlideMenuConfigOverrides = {},
  instanceCount = 1,
  includeAuthoredTrigger = true
): Promise<void> {
  server.updateFiles(buildSlideMenuFiles(overrides, instanceCount, includeAuthoredTrigger))
  await page.goto(server.url, { waitUntil: 'networkidle' })
}
async function openPanel(page: Page) {
  const trigger = page.locator('[data-openpencil-slide-menu-trigger]')
  await trigger.click()
  const panel = page.locator('[data-openpencil-slide-menu-panel]')
  await panel.waitFor({ state: 'visible' })
  await playwrightExpect(panel).toHaveAttribute('data-state', 'open')
  return { panel, trigger }
}
async function waitForOverlayToClose(page: Page): Promise<void> {
  await page.locator('[data-openpencil-slide-menu-overlay]').waitFor({ state: 'detached' })
}

function expectClosedDirection(
  transform: string,
  presentation: SlideMenuPresentation,
  direction: SlideMenuDirection
): void {
  if (presentation === 'menu') {
    const expected = {
      left: '-100%',
      right: '100%',
      top: '-100%',
      bottom: '100%'
    }[direction]
    expect(transform).toContain(expected)
    return
  }
  const expected = {
    left: '- 48px',
    right: '+ 48px',
    top: '- 48px',
    bottom: '+ 48px'
  }[direction]
  expect(transform).toContain(expected)
}

describe('preview browser — compiled Slide Menu module', () => {
  const timeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({ initialFiles: buildSlideMenuFiles() })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 })
  }, timeoutMs)

  afterEach(async () => {
    try {
      await page?.close()
    } finally {
      try {
        await browser?.close()
      } finally {
        await server?.close()
        page = null
        browser = null
        server = null
      }
    }
  }, timeoutMs)

  test(
    'shows the intrinsic trigger icon and label independently without weakening the button',
    async () => {
      if (!server || !page) throw new Error('Missing Slide Menu preview runtime')
      const cases = [
        ['icon and label', true, true, '8px'],
        ['icon only', true, false, '0px'],
        ['label only', false, true, '0px'],
        ['neither icon nor label', false, false, '0px']
      ] as const

      for (const [name, showTriggerIcon, showTriggerLabel, expectedGap] of cases) {
        const triggerLabel = `Open ${name}`
        server.updateFiles(
          buildSlideMenuFiles(
            {
              showTriggerIcon,
              showTriggerLabel,
              triggerLabel
            },
            1,
            false,
            true
          )
        )
        await page.goto(server.url, { waitUntil: 'networkidle' })

        const accessibleLabel = `${triggerLabel} 1`
        const trigger = page.getByRole('button', { name: accessibleLabel })
        await playwrightExpect(trigger).toBeVisible()
        const metrics = await trigger.evaluate((element) => {
          const button = element as HTMLButtonElement
          const icon = button.querySelector<HTMLElement>(
            '[data-openpencil-slide-menu-trigger-icon]'
          )
          const label = button.querySelector<HTMLElement>(
            '[data-openpencil-slide-menu-trigger-label]'
          )
          const bars = [
            ...button.querySelectorAll<HTMLElement>('[data-openpencil-slide-menu-trigger-icon-bar]')
          ]
          const content = [icon, label].filter((candidate): candidate is HTMLElement => !!candidate)
          const buttonRect = button.getBoundingClientRect()
          const contentRects = content.map((candidate) => candidate.getBoundingClientRect())
          const style = getComputedStyle(button)
          return {
            ariaLabel: button.getAttribute('aria-label'),
            backgroundColor: style.backgroundColor,
            barColors: bars.map((bar) => getComputedStyle(bar).backgroundColor),
            barHeights: bars.map((bar) => bar.getBoundingClientRect().height),
            barRadii: bars.map((bar) => getComputedStyle(bar).borderRadius),
            barWidths: bars.map((bar) => bar.getBoundingClientRect().width),
            color: style.color,
            contentHorizontalCenterDelta:
              contentRects.length > 0
                ? (Math.min(...contentRects.map((rect) => rect.left)) +
                    Math.max(...contentRects.map((rect) => rect.right))) /
                    2 -
                  (buttonRect.left + buttonRect.right) / 2
                : null,
            contentVerticalCenterDelta:
              contentRects.length > 0
                ? (Math.min(...contentRects.map((rect) => rect.top)) +
                    Math.max(...contentRects.map((rect) => rect.bottom))) /
                    2 -
                  (buttonRect.top + buttonRect.bottom) / 2
                : null,
            gap: style.gap,
            height: buttonRect.height,
            labelText: label?.textContent,
            minHeight: style.minHeight,
            tagName: button.tagName,
            text: button.textContent?.trim(),
            type: button.type,
            width: buttonRect.width
          }
        })

        expect(metrics).toMatchObject({
          ariaLabel: accessibleLabel,
          backgroundColor: 'rgb(38, 99, 235)',
          color: 'rgb(255, 255, 255)',
          gap: expectedGap,
          height: 48,
          minHeight: '44px',
          tagName: 'BUTTON',
          type: 'button',
          width: 180
        })
        expect(metrics.labelText).toBe(showTriggerLabel ? accessibleLabel : undefined)
        expect(metrics.barColors).toEqual(
          showTriggerIcon ? ['rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)'] : []
        )
        expect(metrics.barHeights).toEqual(showTriggerIcon ? [2, 2, 2] : [])
        expect(metrics.barRadii).toEqual(showTriggerIcon ? ['0px', '0px', '0px'] : [])
        expect(metrics.barWidths).toEqual(showTriggerIcon ? [18, 18, 18] : [])
        if (showTriggerIcon || showTriggerLabel) {
          expect(Math.abs(metrics.contentHorizontalCenterDelta ?? Infinity)).toBeLessThanOrEqual(1)
          expect(Math.abs(metrics.contentVerticalCenterDelta ?? Infinity)).toBeLessThanOrEqual(1)
        } else {
          expect(metrics.text).toBe('')
          await trigger.focus()
          expect(await trigger.evaluate((candidate) => document.activeElement === candidate)).toBe(
            true
          )
          const focusStyle = await trigger.evaluate((candidate) => {
            const style = getComputedStyle(candidate)
            return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) }
          })
          expect(focusStyle.style).not.toBe('none')
          expect(focusStyle.width).toBeGreaterThan(0)
          await trigger.press('Enter')
          await playwrightExpect(
            page.locator('[data-openpencil-slide-menu-panel]')
          ).toHaveAttribute('data-state', 'open')
          await playwrightExpect(trigger).toHaveAttribute('aria-expanded', 'true')
          await page.keyboard.press('Escape')
          await waitForOverlayToClose(page)
          await playwrightExpect(trigger).toHaveAttribute('aria-expanded', 'false')
          expect(await trigger.evaluate((candidate) => document.activeElement === candidate)).toBe(
            true
          )
        }
      }

      await loadFixture(server, page, { showTriggerIcon: false, showTriggerLabel: false })
      const authoredTrigger = page.getByRole('button', { name: 'Open navigation 1' })
      const authoredHost = page.locator('[data-openpencil-slide-menu-trigger-host]')
      const authoredContent = authoredHost.locator('[data-openpencil-slide-menu-trigger-authored]')
      await playwrightExpect(authoredContent).toHaveText('Authored trigger 1')
      await playwrightExpect(authoredContent.locator('button')).toHaveCount(1)
      await playwrightExpect(page.locator('button button')).toHaveCount(0)
      await playwrightExpect(authoredContent).toHaveAttribute('inert', '')
      await playwrightExpect(authoredTrigger).toHaveCount(1)
      await playwrightExpect(
        authoredTrigger.locator(
          '[data-openpencil-slide-menu-trigger-icon], [data-openpencil-slide-menu-trigger-label]'
        )
      ).toHaveCount(0)
      const authoredMetrics = await authoredHost.evaluate((element) => {
        const content = element.querySelector<HTMLElement>(
          '[data-openpencil-slide-menu-trigger-authored]'
        )
        if (!content) throw new Error('Missing authored Slide Menu trigger content')
        const buttonRect = element.getBoundingClientRect()
        const contentRect = content.getBoundingClientRect()
        return {
          centerDelta:
            (contentRect.left + contentRect.right) / 2 - (buttonRect.left + buttonRect.right) / 2,
          gap: getComputedStyle(element).gap
        }
      })
      expect(authoredMetrics.gap).toBe('0px')
      expect(Math.abs(authoredMetrics.centerDelta)).toBeLessThanOrEqual(1)
    },
    timeoutMs
  )

  test(
    'renders both presentations from all four directions and transitions closed',
    async () => {
      if (!server || !page) throw new Error('Missing Slide Menu preview runtime')
      const presentations: SlideMenuPresentation[] = ['menu', 'dialog']
      const directions: SlideMenuDirection[] = ['left', 'right', 'top', 'bottom']

      for (const presentation of presentations) {
        for (const direction of directions) {
          await loadFixture(server, page, { presentation, direction })
          expect(await page.locator('[data-openpencil-slide-menu-overlay]').count()).toBe(0)

          const { panel, trigger } = await openPanel(page)
          expect(await panel.getAttribute('data-presentation')).toBe(presentation)
          expect(await panel.getAttribute('data-direction')).toBe(direction)
          expect(await panel.getAttribute('role')).toBe('dialog')
          expect(await panel.getAttribute('aria-modal')).toBe('true')
          expect(await panel.evaluate((element) => element.parentElement === document.body)).toBe(
            false
          )
          expect(
            await panel.evaluate(
              (element) => element.parentElement?.parentElement === document.body
            )
          ).toBe(true)

          const placement = await panel.evaluate((element) => {
            const style = (element as HTMLElement).style
            return {
              bottom: style.bottom,
              height: style.height,
              left: style.left,
              right: style.right,
              top: style.top,
              width: style.width
            }
          })
          if (presentation === 'dialog') {
            expect(placement.left).toBe('50%')
            expect(placement.top).toBe('50%')
            expect(placement.width).toContain('320px')
          } else if (direction === 'left' || direction === 'right') {
            expect(placement[direction]).toBe('0px')
            expect(placement.height).toBe('100%')
            expect(placement.width).toContain('320px')
          } else {
            expect(placement[direction]).toBe('0px')
            expect(placement.height).toContain('320px')
            expect(placement.width).toBe('100%')
          }

          await page.keyboard.press('Escape')
          expect(await panel.getAttribute('data-state')).toBe('closed')
          expectClosedDirection(
            await panel.evaluate((element) => (element as HTMLElement).style.transform),
            presentation,
            direction
          )
          await waitForOverlayToClose(page)
          expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(true)
        }
      }
    },
    timeoutMs
  )

  test(
    'clamps edge panels to small viewports and reference-counts multi-instance scroll locks',
    async () => {
      if (!server || !page) throw new Error('Missing Slide Menu preview runtime')
      await page.setViewportSize({ width: 360, height: 480 })
      await loadFixture(server, page, { direction: 'left', panelSize: 720 })
      let opened = await openPanel(page)
      expect(await opened.panel.evaluate((element) => element.getBoundingClientRect().width)).toBe(
        344
      )
      await page.keyboard.press('Escape')
      await waitForOverlayToClose(page)

      await loadFixture(server, page, { direction: 'bottom', panelSize: 720 })
      opened = await openPanel(page)
      expect(
        await opened.panel.evaluate((element) => element.getBoundingClientRect().height)
      ).toBeCloseTo(464, 3)
      await page.keyboard.press('Escape')
      await waitForOverlayToClose(page)

      await page.setViewportSize({ width: 900, height: 700 })
      await loadFixture(server, page, {}, 2)
      await page.evaluate(() => {
        document.body.style.overflow = 'auto'
      })
      const triggers = page.locator('[data-openpencil-slide-menu-trigger]')
      const overlays = page.locator('[data-openpencil-slide-menu-overlay]')
      const panels = page.locator('[data-openpencil-slide-menu-panel]')
      await triggers.nth(0).click()
      await playwrightExpect(overlays).toHaveCount(1)
      await triggers.nth(1).evaluate((element) => element.click())
      await playwrightExpect(overlays).toHaveCount(2)
      await playwrightExpect(panels.nth(0)).toHaveAttribute('data-state', 'open')
      await playwrightExpect(panels.nth(1)).toHaveAttribute('data-state', 'open')
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')

      await page.keyboard.press('Escape')
      await playwrightExpect(overlays).toHaveCount(1)
      expect(
        await panels.evaluateAll(
          (elements) => elements.length === 1 && elements[0]?.contains(document.activeElement)
        )
      ).toBe(true)
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')

      await triggers.nth(1).evaluate((element) => element.click())
      await playwrightExpect(overlays).toHaveCount(2)
      await playwrightExpect(panels.nth(1)).toHaveAttribute('data-state', 'open')
      await overlays
        .nth(0)
        .getByRole('button', { name: 'Close' })
        .evaluate((element) => (element as HTMLButtonElement).click())
      await playwrightExpect(overlays).toHaveCount(1)
      expect(
        await panels.evaluateAll(
          (elements) => elements.length === 1 && elements[0]?.contains(document.activeElement)
        )
      ).toBe(true)
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')

      await page.keyboard.press('Escape')
      await waitForOverlayToClose(page)
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('auto')
    },
    timeoutMs
  )

  test(
    'cancels a pending opening frame when Escape dismisses the panel immediately',
    async () => {
      if (!server || !page) throw new Error('Missing Slide Menu preview runtime')
      await loadFixture(server, page)
      await page.evaluate(() => {
        const requestAnimationFrame = window.requestAnimationFrame.bind(window)
        const cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
        const heldFrameId = 2_000_000_000
        let heldCallback: FrameRequestCallback | null = null
        window.requestAnimationFrame = (callback) => {
          if (heldCallback === null) {
            heldCallback = callback
            return heldFrameId
          }
          return requestAnimationFrame(callback)
        }
        window.cancelAnimationFrame = (frameId) => {
          if (frameId === heldFrameId) {
            heldCallback = null
            return
          }
          cancelAnimationFrame(frameId)
        }
        Reflect.set(window, '__releaseHeldSlideMenuFrame', () => {
          const callback = heldCallback
          heldCallback = null
          callback?.(performance.now())
        })
      })

      const trigger = page.locator('[data-openpencil-slide-menu-trigger]')
      await trigger.click()
      const overlay = page.locator('[data-openpencil-slide-menu-overlay]')
      const panel = page.locator('[data-openpencil-slide-menu-panel]')
      await playwrightExpect(overlay).toHaveCount(1)
      await playwrightExpect(panel).toHaveAttribute('data-state', 'closed')
      await playwrightExpect
        .poll(() => page.evaluate(() => document.body.style.overflow))
        .toBe('hidden')

      await page.keyboard.press('Escape')
      await page.evaluate(() => {
        const release = Reflect.get(window, '__releaseHeldSlideMenuFrame')
        if (typeof release === 'function') release()
      })
      await waitForOverlayToClose(page)
      expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(true)
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
    },
    timeoutMs
  )

  test(
    'traps focus, renders strings as text, restores focus, and honors every close control',
    async () => {
      if (!server || !page) throw new Error('Missing Slide Menu preview runtime')
      await page.addInitScript(() => {
        Reflect.set(window, '__openPencilSlideMenuExecuted', false)
      })
      await loadFixture(server, page, {
        title: '<img src=x onerror="window.__openPencilSlideMenuExecuted=true">',
        description: '<script>window.__openPencilSlideMenuExecuted=true</script>',
        items: [
          { label: '<b>First destination</b>', href: '#first' },
          { label: '<img src=x onerror=alert(1)>', href: '#last' }
        ]
      })

      const trigger = page.locator('[data-openpencil-slide-menu-trigger]')
      await trigger.focus()
      await trigger.press('Enter')
      const panel = page.locator('[data-openpencil-slide-menu-panel]')
      await panel.waitFor({ state: 'visible' })
      await playwrightExpect(panel).toHaveAttribute('data-state', 'open')
      const closeButton = page.getByRole('button', { name: 'Close' })
      await playwrightExpect(closeButton).toBeFocused()
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
      expect(await panel.locator('img, script, b').count()).toBe(0)
      expect(
        await page.evaluate(() => Boolean(Reflect.get(window, '__openPencilSlideMenuExecuted')))
      ).toBe(false)
      expect(await panel.getByText('<b>First destination</b>', { exact: true }).count()).toBe(1)

      const links = panel.locator('a')
      await links.last().focus()
      await links.last().press('Tab')
      expect(await closeButton.evaluate((element) => document.activeElement === element)).toBe(true)
      await closeButton.press('Shift+Tab')
      expect(await links.last().evaluate((element) => document.activeElement === element)).toBe(
        true
      )

      await closeButton.click()
      await page.keyboard.press('Tab')
      expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true)
      await waitForOverlayToClose(page)
      expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(true)
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('')

      await openPanel(page)
      await page
        .locator('[data-openpencil-slide-menu-backdrop]')
        .click({ position: { x: 880, y: 12 } })
      await waitForOverlayToClose(page)
      expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(true)

      await loadFixture(server, page, { closeOnBackdrop: false, showCloseButton: false })
      const nonClosingTrigger = page.locator('[data-openpencil-slide-menu-trigger]')
      await openPanel(page)
      expect(await page.getByRole('button', { name: 'Close' }).count()).toBe(0)
      await page
        .locator('[data-openpencil-slide-menu-backdrop]')
        .click({ position: { x: 880, y: 12 } })
      expect(await page.locator('[data-openpencil-slide-menu-overlay]').count()).toBe(1)
      await page.keyboard.press('Escape')
      await waitForOverlayToClose(page)
      expect(
        await nonClosingTrigger.evaluate((element) => document.activeElement === element)
      ).toBe(true)

      await openPanel(page)
      await page.getByRole('link', { name: 'Last destination' }).click()
      await waitForOverlayToClose(page)
      expect(new URL(page.url()).hash).toBe('#last')
    },
    timeoutMs
  )

  test(
    'removes motion for reduced-motion users while keeping Escape dismissal',
    async () => {
      if (!server || !page) throw new Error('Missing Slide Menu preview runtime')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await loadFixture(server, page, { presentation: 'dialog', direction: 'bottom' })
      const { panel, trigger } = await openPanel(page)
      expect(await panel.evaluate((element) => getComputedStyle(element).transition)).toBe('none')
      await page.keyboard.press('Escape')
      await waitForOverlayToClose(page)
      expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(true)
    },
    timeoutMs
  )
})
