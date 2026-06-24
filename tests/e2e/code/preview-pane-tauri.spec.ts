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
}

test('Tauri preview toolbar exposes ui kit and i18n controls', async ({ browser }) => {
  const page = await browser.newPage()
  await page.addInitScript(() => {
    const tauriWindow = window as TauriWindow
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
      if (cmd === 'plugin:shell|stdin_write' || cmd === 'plugin:shell|kill') return null
      if (cmd === 'plugin:event|listen') return 1
      if (cmd === 'plugin:event|unlisten') return null
      if (cmd === 'plugin:event|emit') return null
      if (cmd === 'take_pending_open') return []
      if (cmd === 'list_system_fonts') return []
      return null
    }
  })
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
