import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'

type TauriInternals = {
  metadata?: {
    currentWindow: { label: string }
    currentWebview: { windowLabel: string; label: string }
  }
  callbacks?: Map<number, (value: unknown) => void>
  convertFileSrc?: (path: string) => string
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  runCallback?: (id: number, value: unknown) => void
  transformCallback?: (callback: (value: unknown) => void) => number
  unregisterCallback?: (id: number) => void
}

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: TauriInternals
  __OP_PREVIEW_STDIN__?: string[]
  __OP_PREVIEW_SPAWNS__?: unknown[]
}

async function installTauriPreviewMock(page: Page) {
  await page.addInitScript(() => {
    const tauriWindow = window as TauriWindow
    tauriWindow.__OP_PREVIEW_STDIN__ = []
    tauriWindow.__OP_PREVIEW_SPAWNS__ = []
    tauriWindow.__TAURI_INTERNALS__ ??= {}
    const internals = tauriWindow.__TAURI_INTERNALS__
    internals.metadata = {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' }
    }
    internals.convertFileSrc = (path: string) => `asset://localhost/${path}`
    const callbacks = new Map<number, (value: unknown) => void>()
    let nextCallbackId = 1
    internals.callbacks = callbacks
    internals.transformCallback = (callback: (value: unknown) => void) => {
      const id = nextCallbackId++
      callbacks.set(id, callback)
      return id
    }
    internals.unregisterCallback = (id: number) => {
      callbacks.delete(id)
    }
    internals.runCallback = (id: number, value: unknown) => {
      callbacks.get(id)?.(value)
    }
    let previewEventChannelId: number | null = null
    const previewEventIndexes = new Map<number, number>()
    const emitPreviewStdout = (callbackId: number, payload: string): void => {
      const index = previewEventIndexes.get(callbackId) ?? 0
      previewEventIndexes.set(callbackId, index + 1)
      internals.runCallback?.(callbackId, {
        index,
        message: { event: 'Stdout', payload }
      })
    }
    internals.invoke = async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'plugin:shell|spawn') {
        tauriWindow.__OP_PREVIEW_SPAWNS__?.push(args)
        const onEvent = args?.onEvent as { id?: number } | undefined
        if (!onEvent?.id) throw new Error('Missing shell event channel')
        previewEventChannelId = onEvent.id
        previewEventIndexes.set(onEvent.id, 0)
        window.setTimeout(() => {
          emitPreviewStdout(
            onEvent.id,
            JSON.stringify({
              type: 'ready',
              url: 'http://127.0.0.1:60140/',
              port: 60140
            }) + '\n'
          )
        }, 0)
        return 1
      }
      if (cmd === 'plugin:shell|stdin_write') {
        if (typeof args?.buffer === 'string') {
          tauriWindow.__OP_PREVIEW_STDIN__?.push(args.buffer)
          const command = JSON.parse(args.buffer) as { type?: unknown }
          if (command.type === 'update' && previewEventChannelId !== null) {
            const callbackId = previewEventChannelId
            window.setTimeout(() => {
              emitPreviewStdout(callbackId, JSON.stringify({ type: 'updated' }) + '\n')
            }, 0)
          }
        }
        return null
      }
      if (cmd === 'plugin:shell|kill') return null
      if (cmd === 'plugin:event|listen') return 1
      if (cmd === 'plugin:event|unlisten') return null
      if (cmd === 'plugin:event|emit') return null
      if (cmd === 'take_pending_open') return []
      if (cmd === 'list_system_fonts') return []
      return null
    }
  })
}

async function installPreviewIframeRoute(page: Page): Promise<void> {
  await page.route('http://127.0.0.1:60140/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html>
<html>
  <body>Preview theme bridge fixture</body>
  <script>
    window.addEventListener('message', (event) => {
      const data = event.data
      if (data?.source !== 'op-lowcode-editor' || data.type !== 'theme') return
      if (data.theme !== 'light' && data.theme !== 'dark') return
      document.documentElement.dataset.theme = data.theme
      document.documentElement.classList.toggle('light', data.theme === 'light')
      document.documentElement.classList.toggle('dark', data.theme === 'dark')
      document.documentElement.style.colorScheme = data.theme
    })
  </script>
</html>`
    })
  )
}

test('Tauri preview toolbar exposes ui kit and i18n controls', async ({ browser }) => {
  const page = await browser.newPage()
  await installTauriPreviewMock(page)
  await installPreviewIframeRoute(page)
  await page.goto('/')
  await page.getByTestId('canvas-element').and(page.locator('[data-ready="1"]')).waitFor()
  await page.getByTestId('canvas-loading').waitFor({ state: 'hidden' })

  const pane = page.getByTestId('lowcode-preview-pane')
  await expect(pane).toBeVisible()
  await expect(pane).toContainText('Preview')

  const target = page.getByTestId('lowcode-preview-target')
  await expect(target).toHaveValue('react')

  const uiKit = page.getByTestId('lowcode-preview-uikit')
  await expect(uiKit).toBeVisible()
  await uiKit.selectOption('shadcn')
  await expect(uiKit).toHaveValue('shadcn')

  const theme = page.getByTestId('lowcode-preview-theme')
  await expect(theme).toBeVisible()
  await expect(theme).toHaveValue('light')
  await theme.selectOption('dark')
  await expect(theme).toHaveValue('dark')
  const previewRoot = page.frameLocator('iframe[aria-label="lowcode preview"]').locator('html')
  await expect(previewRoot).toHaveAttribute('data-theme', 'dark')
  await expect(previewRoot).toHaveClass(/dark/)
  await expect(previewRoot).not.toHaveClass(/light/)
  await expect.poll(() => previewRoot.evaluate((element) => element.style.colorScheme)).toBe('dark')

  const i18n = page.getByTestId('lowcode-preview-i18n')
  await expect(i18n).toBeVisible()
  await i18n.check()

  const locales = page.getByTestId('lowcode-preview-locales')
  await expect(locales).toBeVisible()
  await locales.fill('en,zh-CN')
  await expect(locales).toHaveValue('en,zh-CN')

  await target.selectOption('vue')
  await expect(target).toHaveValue('vue')
  await expect(uiKit).toBeDisabled()
  await expect(uiKit).toHaveValue('none')
  await expect(i18n).toBeDisabled()
  await expect(locales).toHaveCount(0)
  await expect(previewRoot).toHaveAttribute('data-theme', 'dark')
  await expect
    .poll(() =>
      page.evaluate(() => {
        const spawns = (window as TauriWindow).__OP_PREVIEW_SPAWNS__ ?? []
        return spawns.some((entry) => {
          const args = (entry as { args?: unknown }).args
          return Array.isArray(args) && args.at(-2) === '--target' && args.at(-1) === 'vue'
        })
      })
    )
    .toBe(true)

  await target.selectOption('react')
  await expect(uiKit).toBeEnabled()
  await expect(i18n).toBeEnabled()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const spawns = (window as TauriWindow).__OP_PREVIEW_SPAWNS__ ?? []
        return spawns.flatMap((entry) => {
          const args = (entry as { args?: unknown }).args
          if (!Array.isArray(args)) return []
          const targetIndex = args.indexOf('--target')
          return typeof args[targetIndex + 1] === 'string' ? [args[targetIndex + 1]] : []
        })
      })
    )
    .toEqual(['react', 'vue', 'react'])

  const status = await pane.textContent()
  expect(status).toContain('http://127.0.0.1:60140/')
  await page.close()
})

test('Tauri compiler preview can be closed, restored, and stays closed after reload', async ({
  browser
}) => {
  const page = await browser.newPage()
  await installTauriPreviewMock(page)
  await page.goto('/')
  await page.getByTestId('canvas-element').and(page.locator('[data-ready="1"]')).waitFor()
  await page.getByTestId('canvas-loading').waitFor({ state: 'hidden' })

  const pane = page.getByTestId('lowcode-preview-pane')
  const close = page.getByTestId('lowcode-preview-close')
  await expect(pane).toBeVisible()
  await expect(close).toHaveAttribute('aria-expanded', 'true')
  await close.click()

  await expect(pane).toHaveCount(0)
  const open = page.getByTestId('lowcode-preview-open')
  await expect(open).toBeVisible()
  await expect(open).toHaveAttribute('aria-expanded', 'false')

  // Switching documents re-keys the SplitterGroup. The in-memory layout must
  // follow its latest emitted value so this remount does not reopen preview.
  await page.keyboard.press('Meta+T')
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(2)
  await expect(open).toBeVisible()
  await page.getByTestId('tabbar-tab').first().click()
  await expect(open).toBeVisible()

  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as TauriWindow).__OP_PREVIEW_STDIN__ ?? []).some((raw) => {
          try {
            return (JSON.parse(raw) as { type?: unknown }).type === 'close'
          } catch {
            return false
          }
        })
      )
    )
    .toBe(true)
  await page.reload()
  await page.getByTestId('canvas-element').and(page.locator('[data-ready="1"]')).waitFor()
  await expect(page.getByTestId('lowcode-preview-open')).toBeVisible()
  await page.getByTestId('lowcode-preview-open').click()
  await expect(pane).toBeVisible()
  await expect(page.getByTestId('lowcode-preview-close')).toBeVisible()
  await page.close()
})

test('Tauri preview compiles rounded card parents with overflow clipping', async ({ browser }) => {
  const page = await browser.newPage()
  await installTauriPreviewMock(page)
  await page.goto('/')
  await page.getByTestId('canvas-element').and(page.locator('[data-ready="1"]')).waitFor()
  await page.getByTestId('canvas-loading').waitFor({ state: 'hidden' })
  await expect(page.getByTestId('lowcode-preview-pane')).toBeVisible()

  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const pageId = store.state.currentPageId
    const card = store.graph.createNode('FRAME', pageId, {
      name: 'Clip ACK Card',
      x: 80,
      y: 80,
      width: 160,
      height: 120,
      cornerRadius: 24,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    store.graph.createNode('RECTANGLE', card.id, {
      name: 'Overflowing child',
      x: -24,
      y: -24,
      width: 96,
      height: 96,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
    store.graph.createNode('TEXT', card.id, {
      name: 'Clip marker',
      text: 'Clip ACK Marker',
      x: 16,
      y: 72,
      width: 120,
      height: 24
    })
    store.state.sceneVersion++
    store.requestRender()
  })

  await page.waitForFunction(() => {
    const writes = (window as TauriWindow).__OP_PREVIEW_STDIN__ ?? []
    return writes.some((raw) => {
      try {
        const message = JSON.parse(raw) as {
          type?: unknown
          files?: Array<[string, string]>
        }
        if (message.type !== 'update') return false
        const app = message.files?.find(([path]) => path === 'src/App.tsx')?.[1]
        return (
          typeof app === 'string' &&
          app.includes('Clip ACK Marker') &&
          /<div[^>]*className="[^"]*\boverflow-hidden\b[^"]*"/.test(app)
        )
      } catch {
        return false
      }
    })
  })

  await page.close()
})
