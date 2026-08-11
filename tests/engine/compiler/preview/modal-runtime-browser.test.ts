import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import {
  createModalModuleFrameOverrides,
  createModalModuleInstance,
  MODAL_MODULE_DEFAULT_CONFIG
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

type ModalOverrides = Partial<typeof MODAL_MODULE_DEFAULT_CONFIG>

function buildModalFiles(
  overrides: ModalOverrides = {},
  instanceCount = 1,
  authoredTrigger = false
) {
  const graph = makeSceneGraph('Compiled Modal runtime')
  const pageId = firstPageId(graph)
  for (let index = 0; index < instanceCount; index += 1) {
    const config = {
      ...MODAL_MODULE_DEFAULT_CONFIG,
      ...overrides,
      triggerLabel: `${overrides.triggerLabel ?? MODAL_MODULE_DEFAULT_CONFIG.triggerLabel} ${index + 1}`
    }
    const frame = graph.createNode('FRAME', pageId, {
      ...createModalModuleFrameOverrides(config),
      x: 40,
      y: 40 + index * 72,
      interactiveProps: { module: createModalModuleInstance(config) }
    })
    if (authoredTrigger) {
      graph.createNode('BUTTON', frame.id, {
        width: 150,
        height: 40,
        x: 15,
        y: 4,
        interactiveProps: { text: `Authored trigger ${index + 1}` }
      })
    }
  }
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'modal-runtime-browser', devMode: false })
  }).files
}

async function loadFixture(
  server: PreviewServer,
  page: Page,
  overrides: ModalOverrides = {},
  instanceCount = 1,
  authoredTrigger = false
): Promise<void> {
  server.updateFiles(buildModalFiles(overrides, instanceCount, authoredTrigger))
  await page.goto(server.url, { waitUntil: 'networkidle' })
}

async function openModal(page: Page, index = 0) {
  const trigger = page.locator('[data-openpencil-modal-trigger]').nth(index)
  await trigger.click()
  const dialog = page.locator('[data-openpencil-modal-panel]').last()
  await playwrightExpect(dialog).toHaveAttribute('data-state', 'open')
  return { dialog, trigger }
}

async function waitForModalCount(page: Page, count: number): Promise<void> {
  await playwrightExpect(page.locator('[data-openpencil-modal-panel]')).toHaveCount(count)
}

describe('preview browser — compiled Modal module', () => {
  const timeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({ initialFiles: buildModalFiles() })
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
    'keeps icon and label independent and avoids a button-inside-button authored trigger',
    async () => {
      if (!server || !page) throw new Error('Missing Modal preview runtime')
      for (const [showTriggerIcon, showTriggerLabel] of [
        [true, true],
        [true, false],
        [false, true],
        [false, false]
      ] as const) {
        await loadFixture(server, page, { showTriggerIcon, showTriggerLabel }, 1, false)
        const trigger = page.getByRole('button', { name: 'Open modal 1' })
        await playwrightExpect(trigger).toBeVisible()
        const metrics = await trigger.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return {
            gap: style.gap,
            height: rect.height,
            icon: Boolean(element.querySelector('[data-openpencil-modal-trigger-icon]')),
            label: element.querySelector('[data-openpencil-modal-trigger-label]')?.textContent,
            minHeight: style.minHeight,
            tag: element.tagName,
            width: rect.width
          }
        })
        expect(metrics).toEqual({
          gap: showTriggerIcon && showTriggerLabel ? '8px' : '0px',
          height: 48,
          icon: showTriggerIcon,
          label: showTriggerLabel ? 'Open modal 1' : undefined,
          minHeight: '44px',
          tag: 'BUTTON',
          width: 180
        })
      }

      await loadFixture(server, page, {}, 1, true)
      const host = page.locator('[data-openpencil-modal-trigger-host]')
      await playwrightExpect(host).toBeVisible()
      expect(await host.locator('button').count()).toBe(2)
      expect(await host.locator('[data-openpencil-modal-trigger] button').count()).toBe(0)
      await playwrightExpect(
        host.locator('[data-openpencil-modal-trigger-authored]')
      ).toHaveAttribute('inert', '')
    },
    timeoutMs
  )

  test(
    'traps focus, keeps text inert, restores focus, and honors every close route',
    async () => {
      if (!server || !page) throw new Error('Missing Modal preview runtime')
      const literalContent = '<img src=x onerror="window.__modalInjected=true">\nSafe second line'
      await loadFixture(server, page, {
        title: 'Review publication',
        content: literalContent,
        cancelLabel: 'Continue editing',
        confirmLabel: 'Publish safely'
      })
      const { dialog, trigger } = await openModal(page)
      await playwrightExpect(dialog).toBeFocused()
      await playwrightExpect(dialog).toHaveAttribute('aria-modal', 'true')
      await playwrightExpect(
        page.getByRole('heading', { name: 'Review publication' })
      ).toBeVisible()
      await playwrightExpect(dialog.locator('[data-openpencil-modal-content]')).toHaveText(
        literalContent
      )
      expect(await dialog.locator('img, script').count()).toBe(0)
      expect(
        await page.evaluate(
          () => (window as Window & { __modalInjected?: boolean }).__modalInjected
        )
      ).toBeUndefined()
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')

      await dialog.press('Tab')
      expect(
        await page.evaluate(() => {
          const panel = document.querySelector('[data-openpencil-modal-panel]')
          return Boolean(panel && document.activeElement && panel.contains(document.activeElement))
        })
      ).toBe(true)

      const close = page.getByRole('button', { name: 'Close modal' })
      await page.waitForTimeout(200)
      const closeMetrics = await close.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const panel = element.closest('[data-openpencil-modal-panel]')?.getBoundingClientRect()
        return {
          height: rect.height,
          path: element.querySelector('path')?.getAttribute('d'),
          rightInset: panel ? panel.right - rect.right : -1,
          topInset: panel ? rect.top - panel.top : -1,
          width: rect.width
        }
      })
      expect(closeMetrics).toMatchObject({
        height: 44,
        path: 'M6 6L18 18M18 6L6 18',
        rightInset: 20,
        topInset: 20,
        width: 44
      })
      await close.click()
      await waitForModalCount(page, 0)
      await playwrightExpect(trigger).toBeFocused()
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('')

      await openModal(page)
      await page.getByRole('button', { name: 'Continue editing' }).click()
      await waitForModalCount(page, 0)
      await openModal(page)
      await page.getByRole('button', { name: 'Publish safely' }).click()
      await waitForModalCount(page, 0)

      await openModal(page)
      await page.keyboard.press('Escape')
      await waitForModalCount(page, 0)

      await loadFixture(server, page, { closeOnEscape: false, closeOnBackdrop: false })
      await openModal(page)
      await page.keyboard.press('Escape')
      await playwrightExpect(page.locator('[data-openpencil-modal-panel]')).toHaveCount(1)
      await page.mouse.click(4, 4)
      await playwrightExpect(page.locator('[data-openpencil-modal-panel]')).toHaveCount(1)
      await page.getByRole('button', { name: 'Close modal' }).click()
      await waitForModalCount(page, 0)

      await loadFixture(server, page)
      await openModal(page)
      await page.mouse.click(4, 4)
      await waitForModalCount(page, 0)
    },
    timeoutMs
  )

  test(
    'clamps long content at 375px, respects reduced motion, and closes only the top stack entry',
    async () => {
      if (!server || !page) throw new Error('Missing Modal preview runtime')
      await page.setViewportSize({ width: 375, height: 600 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await loadFixture(server, page, {
        panelWidth: 720,
        content: 'Long modal content '.repeat(180)
      })
      const { dialog } = await openModal(page)
      const responsive = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const content = element.querySelector<HTMLElement>('[data-openpencil-modal-content]')
        return {
          horizontalOverflow: element.scrollWidth > element.clientWidth,
          maxHeight: getComputedStyle(element).maxHeight,
          transitionDuration: getComputedStyle(element).transitionDuration,
          width: rect.width,
          contentScrollable: Boolean(content && content.scrollHeight > content.clientHeight)
        }
      })
      expect(responsive.width).toBeLessThanOrEqual(343)
      expect(responsive.horizontalOverflow).toBe(false)
      expect(responsive.maxHeight).toBe('568px')
      expect(responsive.transitionDuration).toBe('0s')
      expect(responsive.contentScrollable).toBe(true)
      await page.keyboard.press('Escape')
      await waitForModalCount(page, 0)

      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await loadFixture(server, page, {}, 2)
      await openModal(page, 0)
      await page
        .locator('[data-openpencil-modal-trigger]')
        .nth(1)
        .evaluate((element) => {
          ;(element as HTMLButtonElement).click()
        })
      await waitForModalCount(page, 2)
      await page.keyboard.press('Escape')
      await waitForModalCount(page, 1)
      await playwrightExpect(page.locator('[data-openpencil-modal-panel]')).toHaveAttribute(
        'data-state',
        'open'
      )
      await page.keyboard.press('Escape')
      await waitForModalCount(page, 0)
    },
    timeoutMs
  )
})
