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
}

async function installTauriPreviewMock(page: Page) {
  await page.addInitScript(() => {
    const tauriWindow = window as TauriWindow
    tauriWindow.__OP_PREVIEW_STDIN__ = []
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
    internals.invoke = async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'plugin:shell|spawn') {
        const onEvent = args?.onEvent as { id?: number } | undefined
        if (!onEvent?.id) throw new Error('Missing shell event channel')
        window.setTimeout(() => {
          internals.runCallback?.(onEvent.id, {
            index: 0,
            message: {
              event: 'Stdout',
              payload:
                JSON.stringify({
                  type: 'ready',
                  url: 'http://127.0.0.1:60140/',
                  port: 60140
                }) + '\n'
            }
          })
        }, 0)
        return 1
      }
      if (cmd === 'plugin:shell|stdin_write') {
        if (typeof args?.buffer === 'string') tauriWindow.__OP_PREVIEW_STDIN__?.push(args.buffer)
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

test('Tauri preview toolbar exposes ui kit and i18n controls', async ({ browser }) => {
  const page = await browser.newPage()
  await installTauriPreviewMock(page)
  await page.goto('/')
  await page.getByTestId('canvas-element').and(page.locator('[data-ready="1"]')).waitFor()
  await page.getByTestId('canvas-loading').waitFor({ state: 'hidden' })

  const pane = page.getByTestId('lowcode-preview-pane')
  await expect(pane).toBeVisible()
  await expect(pane).toContainText('Preview')

  const uiKit = page.getByTestId('lowcode-preview-uikit')
  await expect(uiKit).toBeVisible()
  await uiKit.selectOption('shadcn')
  await expect(uiKit).toHaveValue('shadcn')

  const theme = page.getByTestId('lowcode-preview-theme')
  await expect(theme).toBeVisible()
  await expect(theme).toHaveValue('light')
  await theme.selectOption('dark')
  await expect(theme).toHaveValue('dark')

  const i18n = page.getByTestId('lowcode-preview-i18n')
  await expect(i18n).toBeVisible()
  await i18n.check()

  const locales = page.getByTestId('lowcode-preview-locales')
  await expect(locales).toBeVisible()
  await locales.fill('en,zh-CN')
  await expect(locales).toHaveValue('en,zh-CN')

  const status = await pane.textContent()
  expect(status).toContain('http://127.0.0.1:60140/')
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
