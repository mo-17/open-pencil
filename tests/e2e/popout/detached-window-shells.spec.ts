import { expect, test, type Page } from '@playwright/test'

import type { AIPopoutControls } from '@/app/ai/popout/controls'
import type { CompilerPreviewPopoutControls } from '@/app/lowcode/preview-pane/popout/controls'

import { expectInViewport } from '#tests/e2e/fixtures'

interface InvokeCall {
  command: string
  args?: Record<string, unknown>
}

type PopoutTestWindow = Window & {
  __OP_POPOUT_SHELL_TEST__?: {
    calls: InvokeCall[]
    payload: Record<string, unknown>
  }
  __OPENPENCIL_AI_POPOUT_UPDATE__?: (payload: unknown) => void
  __OPENPENCIL_PREVIEW_POPOUT_UPDATE__?: (payload: unknown) => void
  __TAURI_INTERNALS__?: {
    metadata: {
      currentWindow: { label: string }
      currentWebview: { windowLabel: string; label: string }
    }
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  }
}

const AI_CONTROLS: AIPopoutControls = {
  toolbar: true,
  focusEditor: true,
  alwaysOnTop: true,
  clearChat: true,
  settings: true
}

const PREVIEW_CONTROLS: CompilerPreviewPopoutControls = {
  toolbar: true,
  reload: true,
  focusEditor: true,
  alwaysOnTop: true,
  diagnostics: true,
  exportMicrofrontend: true,
  deploy: true
}

async function installAIWindowMock(page: Page): Promise<void> {
  await page.addInitScript((controls: AIPopoutControls) => {
    const projection = {
      protocolVersion: 1,
      contextId: 'context-1',
      documentName: 'Narrow window document',
      providerLabel: 'OpenAI',
      configured: true,
      status: 'ready',
      error: null,
      draft: '',
      canSubmit: true,
      canStop: false,
      canContinue: false,
      canRetry: false,
      canClear: true,
      messages: []
    }
    const payload = {
      envelope: btoa(JSON.stringify(projection)),
      controls,
      revision: 1
    }
    const target = window as PopoutTestWindow
    const state = { calls: [] as InvokeCall[], payload }
    target.__OP_POPOUT_SHELL_TEST__ = state
    target.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'ai-chat-popout' },
        currentWebview: { windowLabel: 'ai-chat-popout', label: 'ai-chat-popout' }
      },
      async invoke(command, args) {
        state.calls.push({ command, ...(args ? { args } : {}) })
        if (command === 'get_ai_window_latest_payload') return state.payload
        return null
      }
    }
  }, AI_CONTROLS)
}

async function installPreviewWindowMock(
  page: Page,
  controls: CompilerPreviewPopoutControls = PREVIEW_CONTROLS
): Promise<void> {
  await page.route('http://127.0.0.1:60140/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Preview</title><main>Preview ready</main>'
    })
  )
  await page.addInitScript((controls: CompilerPreviewPopoutControls) => {
    const payload = {
      url: 'http://127.0.0.1:60140/',
      port: 60_140,
      path: '/',
      controls,
      revision: 1
    }
    const target = window as PopoutTestWindow
    const state = { calls: [] as InvokeCall[], payload }
    target.__OP_POPOUT_SHELL_TEST__ = state
    target.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'lowcode-preview-popout' },
        currentWebview: {
          windowLabel: 'lowcode-preview-popout',
          label: 'lowcode-preview-popout'
        }
      },
      async invoke(command, args) {
        state.calls.push({ command, ...(args ? { args } : {}) })
        if (command === 'get_preview_window_latest_payload') return state.payload
        return null
      }
    }
  }, controls)
}

async function updateAIControls(page: Page, controls: AIPopoutControls): Promise<void> {
  await page.evaluate((nextControls) => {
    const target = window as PopoutTestWindow
    const state = target.__OP_POPOUT_SHELL_TEST__
    if (!state) throw new Error('AI shell test state is missing')
    state.payload = {
      ...state.payload,
      controls: nextControls,
      revision: Number(state.payload.revision) + 1
    }
    target.__OPENPENCIL_AI_POPOUT_UPDATE__?.(state.payload)
  }, controls)
}

async function updatePreviewControls(
  page: Page,
  controls: CompilerPreviewPopoutControls
): Promise<void> {
  await page.evaluate((nextControls) => {
    const target = window as PopoutTestWindow
    const state = target.__OP_POPOUT_SHELL_TEST__
    if (!state) throw new Error('preview shell test state is missing')
    state.payload = {
      ...state.payload,
      controls: nextControls,
      revision: Number(state.payload.revision) + 1
    }
    target.__OPENPENCIL_PREVIEW_POPOUT_UPDATE__?.(state.payload)
  }, controls)
}

async function expectNoHorizontalOverflow(page: Page, toolbarSelector: string): Promise<void> {
  expect(
    await page
      .locator(toolbarSelector)
      .evaluate((element) => element.scrollWidth <= element.clientWidth)
  ).toBe(true)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true)
}

async function expectPreviewMoreMenuPresentation(page: Page): Promise<void> {
  const actions = page.locator('#compiler-preview-more-menu > div')
  await expectInViewport(page, actions)

  const layout = await actions.evaluate((menu) => {
    const menuRect = menu.getBoundingClientRect()
    const menuStyle = getComputedStyle(menu)
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight

    return {
      menu: {
        left: menuRect.left,
        right: menuRect.right,
        top: menuRect.top,
        bottom: menuRect.bottom,
        scrollFits: menu.scrollWidth <= menu.clientWidth && menu.scrollHeight <= menu.clientHeight
      },
      viewport: { width: viewportWidth, height: viewportHeight },
      items: [...menu.querySelectorAll<HTMLButtonElement>('button:not([hidden])')].map((button) => {
        const buttonRect = button.getBoundingClientRect()
        const style = getComputedStyle(button)
        const textNode = [...button.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
        )
        if (!textNode?.textContent) throw new Error(`Missing text node for ${button.id}`)
        const start = textNode.textContent.search(/\S/)
        const end = textNode.textContent.trimEnd().length
        const range = document.createRange()
        range.setStart(textNode, start)
        range.setEnd(textNode, end)
        const textRect = range.getBoundingClientRect()
        const borderIsVisible =
          style.borderTopStyle !== 'none' &&
          Number.parseFloat(style.borderTopWidth) > 0 &&
          style.borderTopColor !== 'transparent' &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)'
        const backgroundMatchesMenu =
          style.backgroundColor === 'transparent' ||
          style.backgroundColor === 'rgba(0, 0, 0, 0)' ||
          style.backgroundColor === menuStyle.backgroundColor

        return {
          id: button.id,
          label: button.textContent.trim(),
          button: {
            left: buttonRect.left,
            right: buttonRect.right,
            top: buttonRect.top,
            bottom: buttonRect.bottom
          },
          text: {
            left: textRect.left,
            right: textRect.right,
            top: textRect.top,
            bottom: textRect.bottom
          },
          contentFits:
            button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight,
          borderIsVisible,
          backgroundMatchesMenu,
          textAlign: style.textAlign
        }
      })
    }
  })

  expect(layout.menu.left).toBeGreaterThanOrEqual(0)
  expect(layout.menu.top).toBeGreaterThanOrEqual(0)
  expect(layout.menu.right).toBeLessThanOrEqual(layout.viewport.width)
  expect(layout.menu.bottom).toBeLessThanOrEqual(layout.viewport.height)
  expect(layout.menu.scrollFits).toBe(true)
  expect(layout.items.map((item) => item.label)).toEqual([
    'Diagnostics',
    'Export microfrontend…',
    'Deploy…'
  ])

  for (const item of layout.items) {
    expect(item.button.left, `${item.id} must stay inside the menu`).toBeGreaterThanOrEqual(
      layout.menu.left
    )
    expect(item.button.right, `${item.id} must stay inside the menu`).toBeLessThanOrEqual(
      layout.menu.right
    )
    expect(
      item.text.left,
      `${item.id} text must not be clipped on the left`
    ).toBeGreaterThanOrEqual(item.button.left)
    expect(item.text.right, `${item.id} text must not be clipped on the right`).toBeLessThanOrEqual(
      item.button.right
    )
    expect(item.text.top, `${item.id} text must not be clipped at the top`).toBeGreaterThanOrEqual(
      item.button.top
    )
    expect(
      item.text.bottom,
      `${item.id} text must not be clipped at the bottom`
    ).toBeLessThanOrEqual(item.button.bottom)
    expect(item.contentFits, `${item.id} content must fit without scrolling`).toBe(true)
    expect(item.borderIsVisible, `${item.id} must look like a flat menu item`).toBe(false)
    expect(item.backgroundMatchesMenu, `${item.id} must use the menu surface`).toBe(true)
    expect(item.textAlign, `${item.id} must keep menu labels left-aligned`).toBe('left')
  }
}

test('AI popout More menu is keyboard-operable and contained at its minimum size', async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 480 })
  await installAIWindowMock(page)
  await page.goto('/ai-popout.html')

  const toolbar = page.locator('#ai-popout-toolbar')
  const more = page.locator('#ai-popout-more')
  const menu = page.locator('#ai-popout-more-menu')
  const clear = page.locator('#ai-popout-clear')
  const settings = page.locator('#ai-popout-settings')
  const editor = page.locator('#ai-popout-focus-editor')

  await expect(toolbar).toBeVisible()
  await expect(more).toBeVisible()
  await expectNoHorizontalOverflow(page, '#ai-popout-toolbar')

  await more.focus()
  await page.keyboard.press('ArrowDown')
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(clear).toBeFocused()
  await expectInViewport(page, menu)

  await page.keyboard.press('ArrowDown')
  await expect(settings).toBeFocused()
  await page.keyboard.press('Home')
  await expect(clear).toBeFocused()
  await page.keyboard.press('End')
  await expect(settings).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(more).toBeFocused()

  await page.keyboard.press('ArrowDown')
  await expect(clear).toBeFocused()
  await updateAIControls(page, { ...AI_CONTROLS, clearChat: false })
  await expect(settings).toBeFocused()
  await updateAIControls(page, { ...AI_CONTROLS, clearChat: false, settings: false })
  await expect(more).toBeHidden()
  await expect(editor).toBeFocused()

  await updateAIControls(page, { ...AI_CONTROLS, clearChat: false })
  await more.focus()
  await page.keyboard.press('ArrowDown')
  await expect(settings).toBeFocused()
  await page.keyboard.press('Enter')

  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (window as PopoutTestWindow).__OP_POPOUT_SHELL_TEST__?.calls ?? []
        return calls.findLast((call) => call.command === 'send_ai_window_intent')
      })
    )
    .toEqual({
      command: 'send_ai_window_intent',
      args: {
        intent: {
          type: 'openSettings',
          contextId: 'context-1',
          clientActionId: expect.stringMatching(/^ai-/)
        }
      }
    })
})

test('compiler preview disclosure fits, restores focus, and sends exact existing actions', async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 240 })
  await installPreviewWindowMock(page, { ...PREVIEW_CONTROLS, alwaysOnTop: false })
  await page.goto('/preview-popout.html')

  const toolbar = page.locator('#compiler-preview-toolbar')
  const reload = page.locator('#compiler-preview-reload')
  const disclosure = page.locator('#compiler-preview-more-menu')
  const summary = page.locator('#compiler-preview-more-menu-summary')
  const diagnostics = page.locator('#compiler-preview-diagnostics')
  const exportMicrofrontend = page.locator('#compiler-preview-export-microfrontend')

  await expect(toolbar).toBeVisible()
  await expect(summary).toBeVisible()
  await expect(disclosure).not.toHaveAttribute('role', 'menu')
  await expect(diagnostics).not.toHaveAttribute('role', 'menuitem')
  await expectNoHorizontalOverflow(page, '#compiler-preview-toolbar')

  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(disclosure).toHaveAttribute('open', '')
  await expectPreviewMoreMenuPresentation(page)
  await page.keyboard.press('Tab')
  await expect(diagnostics).toBeFocused()

  await updatePreviewControls(page, { ...PREVIEW_CONTROLS, diagnostics: false })
  await expect(disclosure).not.toHaveAttribute('open', '')
  await expect(reload).toBeFocused()

  await summary.focus()
  await page.keyboard.press('Space')
  await expect(disclosure).toHaveAttribute('open', '')
  await exportMicrofrontend.click()

  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (window as PopoutTestWindow).__OP_POPOUT_SHELL_TEST__?.calls ?? []
        return calls.findLast((call) => call.command === 'send_preview_window_intent')
      })
    )
    .toEqual({
      command: 'send_preview_window_intent',
      args: { intent: { type: 'exportMicrofrontend' } }
    })
})

test('compiler preview More menu stays complete when a wide window leaves its trigger near the left edge', async ({
  page
}) => {
  await page.setViewportSize({ width: 1_280, height: 720 })
  await installPreviewWindowMock(page, { ...PREVIEW_CONTROLS, alwaysOnTop: false })
  await page.goto('/preview-popout.html')

  const toolbar = page.locator('#compiler-preview-toolbar')
  const alwaysOnTop = page.locator('#compiler-preview-always-on-top')
  const disclosure = page.locator('#compiler-preview-more-menu')
  const summary = page.locator('#compiler-preview-more-menu-summary')

  await expect(toolbar).toBeVisible()
  await expect(alwaysOnTop).toBeHidden()
  await expect(summary).toBeVisible()
  await expectNoHorizontalOverflow(page, '#compiler-preview-toolbar')

  const summaryBox = await summary.boundingBox()
  if (!summaryBox) throw new Error('Expected More summary to have a bounding box')
  expect(summaryBox.x + summaryBox.width).toBeLessThan(240)

  await summary.click()
  await expect(disclosure).toHaveAttribute('open', '')
  await expectPreviewMoreMenuPresentation(page)

  await page.setViewportSize({ width: 360, height: 240 })
  await expectNoHorizontalOverflow(page, '#compiler-preview-toolbar')
  await expect(disclosure).toHaveAttribute('open', '')
  await expectPreviewMoreMenuPresentation(page)

  await page.setViewportSize({ width: 1_280, height: 720 })
  await expectNoHorizontalOverflow(page, '#compiler-preview-toolbar')
  await expect(disclosure).toHaveAttribute('open', '')
  await expectPreviewMoreMenuPresentation(page)

  const restoredSummaryBox = await summary.boundingBox()
  if (!restoredSummaryBox) throw new Error('Expected restored More summary to have a bounding box')
  expect(restoredSummaryBox.x + restoredSummaryBox.width).toBeLessThan(240)
})
