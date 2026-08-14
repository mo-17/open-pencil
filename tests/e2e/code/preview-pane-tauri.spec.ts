/* oxlint-disable eslint/max-lines -- Preview toolbar workflows share one stateful Tauri IPC fixture. */
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

type PreviewWindowRequest = {
  url: string
  port: number
  path: string
  controls: {
    toolbar: boolean
    reload: boolean
    focusEditor: boolean
    alwaysOnTop: boolean
    diagnostics: boolean
    exportMicrofrontend: boolean
    deploy: boolean
  }
}

type PreviewWindowInvocation = {
  command: 'open_preview_window' | 'update_preview_window' | 'close_preview_window'
  request?: PreviewWindowRequest
  action?: 'created' | 'focused' | 'unchanged' | 'navigated'
}

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: TauriInternals
  __TAURI_EVENT_PLUGIN_INTERNALS__?: {
    unregisterListener?: (event: string, eventId: number) => void
  }
  __OP_PREVIEW_WINDOW_INVOCATIONS__?: PreviewWindowInvocation[]
  __OP_PREVIEW_WINDOW_OPEN__?: boolean
  __OP_PREVIEW_AUTO_ACK__?: boolean
  __OP_PREVIEW_PENDING_ACKS__?: Array<() => void>
  __OP_PREVIEW_RELEASE_ACKS__?: () => void
  __OP_PREVIEW_TERMINATE__?: (code?: number | null) => void
  __OP_PREVIEW_STDIN__?: string[]
  __OP_PREVIEW_SPAWNS__?: unknown[]
  __OP_CODEPEN_PREFILLS__?: unknown[]
}

async function installTauriPreviewMock(page: Page, options?: { autoUpdateAck?: boolean }) {
  await page.addInitScript(
    ({ autoUpdateAck }) => {
      const tauriWindow = window as TauriWindow
      tauriWindow.__OP_PREVIEW_WINDOW_INVOCATIONS__ = []
      tauriWindow.__OP_PREVIEW_WINDOW_OPEN__ = false
      tauriWindow.__OP_PREVIEW_AUTO_ACK__ = autoUpdateAck
      tauriWindow.__OP_PREVIEW_PENDING_ACKS__ = []
      tauriWindow.__OP_PREVIEW_RELEASE_ACKS__ = () => {
        for (const acknowledge of tauriWindow.__OP_PREVIEW_PENDING_ACKS__?.splice(0) ?? []) {
          acknowledge()
        }
      }
      tauriWindow.__OP_PREVIEW_STDIN__ = []
      tauriWindow.__OP_PREVIEW_SPAWNS__ = []
      tauriWindow.__OP_CODEPEN_PREFILLS__ = []
      tauriWindow.__TAURI_INTERNALS__ ??= {}
      const internals = tauriWindow.__TAURI_INTERNALS__
      internals.metadata = {
        currentWindow: { label: 'main' },
        currentWebview: { windowLabel: 'main', label: 'main' }
      }
      internals.convertFileSrc = (path: string) => `asset://localhost/${path}`
      const callbacks = new Map<number, (value: unknown) => void>()
      let nextCallbackId = 1
      let nextEventId = 1
      const eventListeners = new Map<number, { event: string; callbackId: number }>()
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
      tauriWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ ??= {}
      tauriWindow.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener = (
        _event: string,
        eventId: number
      ) => {
        const listener = eventListeners.get(eventId)
        if (listener) callbacks.delete(listener.callbackId)
        eventListeners.delete(eventId)
      }
      let previewEventChannelId: number | null = null
      const previewEventIndexes = new Map<number, number>()
      const emitShellEvent = (callbackId: number, event: string, payload: unknown): void => {
        const index = previewEventIndexes.get(callbackId) ?? 0
        previewEventIndexes.set(callbackId, index + 1)
        internals.runCallback?.(callbackId, {
          index,
          message: { event, payload }
        })
      }
      tauriWindow.__OP_PREVIEW_TERMINATE__ = (code = 1) => {
        if (previewEventChannelId === null) throw new Error('Missing preview sidecar callback')
        emitShellEvent(previewEventChannelId, 'Terminated', { code, signal: null })
      }
      const emitPreviewStdout = (callbackId: number, payload: string): void => {
        emitShellEvent(callbackId, 'Stdout', payload)
      }
      const emitTauriEvent = (event: string, payload: unknown): void => {
        for (const [eventId, listener] of eventListeners) {
          if (listener.event !== event) continue
          internals.runCallback?.(listener.callbackId, { event, id: eventId, payload })
        }
      }
      // oxlint-disable-next-line complexity -- One deterministic IPC dispatcher keeps the shared Tauri mock state coherent.
      internals.invoke = async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === 'open_preview_window' || cmd === 'update_preview_window') {
          const request = args?.request as PreviewWindowRequest | undefined
          if (!request) throw new Error(`Missing ${cmd} request`)
          if (cmd === 'update_preview_window' && !tauriWindow.__OP_PREVIEW_WINDOW_OPEN__) {
            tauriWindow.__OP_PREVIEW_WINDOW_INVOCATIONS__?.push({ command: cmd, request })
            return null
          }
          const wasOpen = tauriWindow.__OP_PREVIEW_WINDOW_OPEN__ === true
          const action =
            cmd === 'open_preview_window' ? (wasOpen ? 'focused' : 'created') : 'unchanged'
          tauriWindow.__OP_PREVIEW_WINDOW_OPEN__ = true
          tauriWindow.__OP_PREVIEW_WINDOW_INVOCATIONS__?.push({ command: cmd, request, action })
          return {
            label: 'lowcode-preview-popout',
            url: new URL(request.path, request.url).href,
            action
          }
        }
        if (cmd === 'close_preview_window') {
          const wasOpen = tauriWindow.__OP_PREVIEW_WINDOW_OPEN__ === true
          tauriWindow.__OP_PREVIEW_WINDOW_OPEN__ = false
          tauriWindow.__OP_PREVIEW_WINDOW_INVOCATIONS__?.push({
            command: 'close_preview_window'
          })
          if (wasOpen) {
            emitTauriEvent('preview-window-destroyed', { label: 'lowcode-preview-popout' })
          }
          return wasOpen
        }
        if (cmd === 'open_codepen_prefill') {
          const request = args?.request
          tauriWindow.__OP_CODEPEN_PREFILLS__?.push(request)
          return {
            endpoint: 'https://codepen.io/cpe/pen/define/',
            opened: true
          }
        }
        if (cmd === 'plugin:shell|spawn') {
          tauriWindow.__OP_PREVIEW_SPAWNS__?.push(args)
          const onEvent = args?.onEvent as { id?: number } | undefined
          if (!onEvent?.id) throw new Error('Missing shell event channel')
          const shellArgs = args?.args
          const isMicrofrontendBuild =
            Array.isArray(shellArgs) &&
            shellArgs.includes('build') &&
            shellArgs.includes('--packaging') &&
            shellArgs.includes('microfrontend')
          const isCodePenBuild = Array.isArray(shellArgs) && shellArgs.includes('codepen')
          if (isCodePenBuild) {
            const flagValue = (flag: string): string => {
              const index = shellArgs.indexOf(flag)
              const value = shellArgs[index + 1]
              if (typeof value !== 'string') throw new Error(`Missing ${flag} CodePen argument`)
              return value
            }
            previewEventIndexes.set(onEvent.id, 0)
            window.setTimeout(() => {
              emitShellEvent(
                onEvent.id,
                'Stdout',
                JSON.stringify({
                  compatible: true,
                  target: flagValue('--target'),
                  packageName: flagValue('--package-name'),
                  data: {
                    title: flagValue('--title'),
                    html: '<div id="root"></div>',
                    html_pre_processor: 'none',
                    css: 'body{margin:0}',
                    css_pre_processor: 'none',
                    js: 'document.body.dataset.showcase="ready"',
                    js_pre_processor: 'none'
                  },
                  diagnostics: [],
                  warnings: []
                }) + '\n'
              )
              emitShellEvent(onEvent.id, 'Terminated', { code: 0, signal: null })
            }, 0)
            return 3
          }
          if (isMicrofrontendBuild) {
            const flagValue = (flag: string): string => {
              const index = shellArgs.indexOf(flag)
              const value = shellArgs[index + 1]
              if (typeof value !== 'string') throw new Error(`Missing ${flag} build argument`)
              return value
            }
            previewEventIndexes.set(onEvent.id, 0)
            window.setTimeout(() => {
              emitShellEvent(
                onEvent.id,
                'Stdout',
                JSON.stringify({
                  outDir: flagValue('-o'),
                  packageName: flagValue('--package-name'),
                  target: flagValue('--target'),
                  files: ['index.html', 'openpencil.microfrontend.json'],
                  warnings: [],
                  microfrontend: {
                    manifest: { digest: 'A'.repeat(43), byteLength: 321 }
                  }
                }) + '\n'
              )
              emitShellEvent(onEvent.id, 'Terminated', { code: 0, signal: null })
            }, 0)
            return 2
          }
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
              const acknowledge = (): void => {
                emitPreviewStdout(callbackId, JSON.stringify({ type: 'updated' }) + '\n')
              }
              if (tauriWindow.__OP_PREVIEW_AUTO_ACK__) {
                window.setTimeout(acknowledge, 0)
              } else {
                tauriWindow.__OP_PREVIEW_PENDING_ACKS__?.push(acknowledge)
              }
            }
          }
          return null
        }
        if (cmd === 'plugin:shell|kill') return null
        if (cmd === 'plugin:dialog|open') return '/tmp/openpencil-mfe-output'
        if (cmd === 'plugin:path|resolve_directory') return '/tmp'
        if (cmd === 'plugin:path|join') {
          const paths = args?.paths
          return Array.isArray(paths) ? paths.join('/').replace(/\/{2,}/g, '/') : null
        }
        if (cmd === 'plugin:fs|write_file') return null
        if (cmd === 'plugin:fs|remove') return null
        if (cmd === 'build_fig_file') return [70, 73, 71]
        if (cmd === 'plugin:event|listen') {
          const event = args?.event
          const callbackId = args?.handler
          if (typeof event !== 'string' || typeof callbackId !== 'number') {
            throw new TypeError('Invalid Tauri event listener')
          }
          const eventId = nextEventId++
          eventListeners.set(eventId, { event, callbackId })
          return eventId
        }
        if (cmd === 'plugin:event|unlisten') {
          const eventId = args?.eventId
          if (typeof eventId === 'number') {
            const listener = eventListeners.get(eventId)
            if (listener) callbacks.delete(listener.callbackId)
            eventListeners.delete(eventId)
          }
          return null
        }
        if (cmd === 'plugin:event|emit') return null
        if (cmd === 'take_pending_open') return []
        if (cmd === 'list_system_fonts') return []
        return null
      }
    },
    { autoUpdateAck: options?.autoUpdateAck ?? true }
  )
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

test('Tauri preview waits for the initial VFS acknowledgement before mounting', async ({
  browser
}) => {
  const page = await browser.newPage()
  await installTauriPreviewMock(page, { autoUpdateAck: false })
  await installPreviewIframeRoute(page)
  await page.setViewportSize({ width: 2200, height: 900 })
  await page.goto('/')
  await page.getByTestId('canvas-element').and(page.locator('[data-ready="1"]')).waitFor()
  await page.getByTestId('canvas-loading').waitFor({ state: 'hidden' })

  const pane = page.getByTestId('lowcode-preview-pane')
  const previewFrame = page.locator('iframe[aria-label="lowcode preview"]')
  await expect(pane).toContainText('Starting dev server…')
  await expect(previewFrame).toHaveCount(0)
  await expect(page.getByTestId('lowcode-preview-popout-toggle')).toBeDisabled()
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as TauriWindow).__OP_PREVIEW_STDIN__ ?? []).some((raw) => {
          try {
            return (JSON.parse(raw) as { type?: unknown }).type === 'update'
          } catch {
            return false
          }
        })
      )
    )
    .toBe(true)

  await page.evaluate(() => (window as TauriWindow).__OP_PREVIEW_RELEASE_ACKS__?.())
  await expect(previewFrame).toBeVisible()
  await expect(pane).toContainText('http://127.0.0.1:60140/')
  await expect(page.getByTestId('lowcode-preview-popout-toggle')).toBeEnabled()
  await page.close()
})

test('Tauri preview removes the iframe when its sidecar exits', async ({ browser }) => {
  const page = await browser.newPage()
  await installTauriPreviewMock(page)
  await installPreviewIframeRoute(page)
  await page.setViewportSize({ width: 2200, height: 900 })
  await page.goto('/')
  await page.getByTestId('canvas-element').and(page.locator('[data-ready="1"]')).waitFor()
  await page.getByTestId('canvas-loading').waitFor({ state: 'hidden' })

  const pane = page.getByTestId('lowcode-preview-pane')
  const previewFrame = page.locator('iframe[aria-label="lowcode preview"]')
  await expect(previewFrame).toBeVisible()
  await page.evaluate(() => (window as TauriWindow).__OP_PREVIEW_TERMINATE__?.(1))

  await expect(previewFrame).toHaveCount(0)
  await expect(pane).toContainText('Error: dev-server exited (code 1)')
  await expect(page.getByTestId('lowcode-preview-popout-toggle')).toBeDisabled()
  await page.close()
})

test('Tauri compiler preview popout opens, refocuses, and survives pane collapse', async ({
  browser
}) => {
  const page = await browser.newPage()
  await installTauriPreviewMock(page)
  await installPreviewIframeRoute(page)
  await page.setViewportSize({ width: 2200, height: 900 })
  await page.goto('/')
  await page.getByTestId('canvas-element').and(page.locator('[data-ready="1"]')).waitFor()
  await page.getByTestId('canvas-loading').waitFor({ state: 'hidden' })

  const pane = page.getByTestId('lowcode-preview-pane')
  const toolbar = page.getByTestId('lowcode-preview-toolbar')
  const popout = page.getByTestId('lowcode-preview-popout-toggle')
  await expect(pane).toBeVisible()
  await expect(toolbar).toHaveAttribute('data-layout', 'classic')
  await expect(popout).toBeVisible()
  await expect(popout).toBeEnabled()

  const previewSpawnCount = await page.evaluate(
    () => (window as TauriWindow).__OP_PREVIEW_SPAWNS__?.length ?? 0
  )
  await popout.click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as TauriWindow).__OP_PREVIEW_WINDOW_INVOCATIONS__ ?? []).filter(
          (invocation) => invocation.command === 'open_preview_window'
        )
      )
    )
    .toEqual([
      {
        command: 'open_preview_window',
        request: {
          url: 'http://127.0.0.1:60140/',
          port: 60140,
          path: '/',
          controls: {
            toolbar: true,
            reload: true,
            focusEditor: true,
            alwaysOnTop: false,
            diagnostics: true,
            exportMicrofrontend: true,
            deploy: true
          }
        },
        action: 'created'
      }
    ])
  await expect(popout).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() => page.evaluate(() => (window as TauriWindow).__OP_PREVIEW_WINDOW_OPEN__))
    .toBe(true)
  await expect
    .poll(() => page.evaluate(() => (window as TauriWindow).__OP_PREVIEW_SPAWNS__?.length ?? 0))
    .toBe(previewSpawnCount)

  await popout.click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as TauriWindow).__OP_PREVIEW_WINDOW_INVOCATIONS__ ?? []).filter(
          (invocation) => invocation.command === 'open_preview_window'
        )
      )
    )
    .toEqual([
      {
        command: 'open_preview_window',
        request: {
          url: 'http://127.0.0.1:60140/',
          port: 60140,
          path: '/',
          controls: {
            toolbar: true,
            reload: true,
            focusEditor: true,
            alwaysOnTop: false,
            diagnostics: true,
            exportMicrofrontend: true,
            deploy: true
          }
        },
        action: 'created'
      },
      {
        command: 'open_preview_window',
        request: {
          url: 'http://127.0.0.1:60140/',
          port: 60140,
          path: '/',
          controls: {
            toolbar: true,
            reload: true,
            focusEditor: true,
            alwaysOnTop: false,
            diagnostics: true,
            exportMicrofrontend: true,
            deploy: true
          }
        },
        action: 'focused'
      }
    ])

  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await page.getByTestId('settings-plugins-view').getByText('Installed', { exact: true }).click()
  await page.getByTestId('plugin-compiler-preview-popout-control-reload').click()
  await page.getByTestId('plugin-compiler-preview-popout-control-always-on-top').click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          ((window as TauriWindow).__OP_PREVIEW_WINDOW_INVOCATIONS__ ?? []).findLast(
            (invocation) => invocation.command === 'update_preview_window'
          )?.request?.controls
      )
    )
    .toEqual({
      toolbar: true,
      reload: false,
      focusEditor: true,
      alwaysOnTop: true,
      diagnostics: true,
      exportMicrofrontend: true,
      deploy: true
    })
  await page.getByTestId('app-settings-done').click()

  await page.getByTestId('lowcode-preview-close').click()
  await expect(page.getByTestId('lowcode-preview-open')).toBeVisible()
  await expect(pane).toBeHidden()
  await expect(pane).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(() => ({
        open: (window as TauriWindow).__OP_PREVIEW_WINDOW_OPEN__,
        closes: ((window as TauriWindow).__OP_PREVIEW_WINDOW_INVOCATIONS__ ?? []).filter(
          (invocation) => invocation.command === 'close_preview_window'
        ).length,
        previewSpawns: (window as TauriWindow).__OP_PREVIEW_SPAWNS__?.length ?? 0,
        sidecarClosed: ((window as TauriWindow).__OP_PREVIEW_STDIN__ ?? []).some((raw) => {
          try {
            return (JSON.parse(raw) as { type?: unknown }).type === 'close'
          } catch {
            return false
          }
        })
      }))
    )
    .toEqual({
      open: true,
      closes: 0,
      previewSpawns: previewSpawnCount,
      sidecarClosed: false
    })

  await page.close()
})

test('Tauri preview toolbar switches and persists layout without recompiling', async ({
  browser
}) => {
  const page = await browser.newPage()
  await installTauriPreviewMock(page)
  await installPreviewIframeRoute(page)
  await page.goto('/')
  await page.getByTestId('canvas-element').and(page.locator('[data-ready="1"]')).waitFor()
  await page.getByTestId('canvas-loading').waitFor({ state: 'hidden' })
  await expect(page.getByTestId('lowcode-preview-toolbar')).toHaveAttribute(
    'data-layout',
    'classic'
  )

  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-appearance').click()
  const spawnCount = await page.evaluate(
    () => (window as TauriWindow).__OP_PREVIEW_SPAWNS__?.length ?? 0
  )

  await page.getByTestId('settings-preview-toolbar-layout-adaptive').click()
  await expect(page.getByTestId('lowcode-preview-toolbar')).toHaveAttribute(
    'data-layout',
    'adaptive'
  )
  await expect(page.getByTestId('lowcode-preview-settings-toggle')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as TauriWindow).__OP_PREVIEW_SPAWNS__?.length ?? 0))
    .toBe(spawnCount)

  await page.getByTestId('app-settings-done').click()
  const toolbar = page.getByTestId('lowcode-preview-toolbar')
  await expect
    .poll(() => toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true)

  await page.getByTestId('lowcode-preview-settings-toggle').click()
  await expect(page.getByTestId('lowcode-preview-settings-panel')).toBeVisible()
  await expect(page.getByTestId('lowcode-preview-uikit')).toHaveValue('none')
  await expect(page.getByTestId('lowcode-preview-theme')).toHaveValue('light')
  await expect(page.getByTestId('lowcode-preview-refresh-policy')).toHaveValue('auto')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('lowcode-preview-settings-panel')).toHaveCount(0)
  await expect(page.getByTestId('lowcode-preview-settings-toggle')).toBeFocused()

  await page.reload()
  await page.getByTestId('canvas-element').and(page.locator('[data-ready="1"]')).waitFor()
  await expect(page.getByTestId('lowcode-preview-toolbar')).toHaveAttribute(
    'data-layout',
    'adaptive'
  )

  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-appearance').click()
  await page.getByTestId('settings-preview-toolbar-layout-compact').click()
  await expect(page.getByTestId('lowcode-preview-toolbar')).toHaveAttribute(
    'data-layout',
    'compact'
  )
  await page.getByTestId('app-settings-done').click()
  const compactToolbar = page.getByTestId('lowcode-preview-toolbar')
  await expect
    .poll(() => compactToolbar.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true)
  await page.getByTestId('lowcode-preview-more-toggle').click()
  const compactMoreMenu = page.getByTestId('lowcode-preview-more-menu')
  await expect(compactMoreMenu).toContainText('Diagnostics')
  await expect(compactMoreMenu).toContainText('Motion runtime')
  const compactPopout = page.getByTestId('lowcode-preview-more-popout')
  await expect(compactPopout).toBeVisible()
  await expect(compactPopout).toContainText('Open preview window')
  await compactPopout.click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          ((window as TauriWindow).__OP_PREVIEW_WINDOW_INVOCATIONS__ ?? []).filter(
            (invocation) => invocation.command === 'open_preview_window'
          ).length
      )
    )
    .toBe(1)
  await page.close()
})

test('Tauri grouped preview toolbar responds to pane width without overflow', async ({
  browser
}) => {
  const page = await browser.newPage()
  await installTauriPreviewMock(page)
  await installPreviewIframeRoute(page)
  await page.addInitScript(() => {
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Seed preferences before app modules initialize.
    window.localStorage.setItem('open-pencil:preview-toolbar-layout', 'adaptive')
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Seed the splitter width before its first render.
    window.localStorage.setItem('open-pencil:editor-layout', JSON.stringify([18, 64, 18, 30]))
  })

  await page.setViewportSize({ width: 3200, height: 1000 })
  await page.goto('/')
  await page.getByTestId('canvas-element').and(page.locator('[data-ready="1"]')).waitFor()
  await page.getByTestId('canvas-loading').waitFor({ state: 'hidden' })

  const toolbar = page.getByTestId('lowcode-preview-toolbar')
  const fits = () => toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)
  await expect(toolbar).toHaveAttribute('data-band', 'wide')
  await expect.poll(fits).toBe(true)
  await expect(page.getByTestId('lowcode-preview-popout-toggle')).toBeVisible()
  await expect(page.getByTestId('lowcode-preview-popout-toggle')).toBeEnabled()

  const microfrontendExport = page.getByTestId('lowcode-microfrontend-export-toggle')
  await expect(microfrontendExport).toBeVisible()
  await expect(microfrontendExport).toContainText('Export MFE')
  const codePenShowcase = page.getByTestId('lowcode-codepen-showcase-toggle')
  await expect(codePenShowcase).toBeVisible()
  await expect(codePenShowcase).toContainText('CodePen')
  await microfrontendExport.click()

  const dialog = page.getByTestId('lowcode-microfrontend-export-dialog')
  const appId = page.getByTestId('lowcode-microfrontend-app-id')
  const version = page.getByTestId('lowcode-microfrontend-version')
  const submit = page.getByTestId('lowcode-microfrontend-export-submit')
  await expect(dialog).toBeVisible()
  await expect(appId).toHaveValue('openpencil.untitled')
  await expect(version).toHaveValue('0.0.0')

  await appId.fill('Invalid App!')
  await expect(appId).toHaveAttribute('aria-invalid', 'true')
  await expect(submit).toBeDisabled()
  await appId.fill('openpencil.checkout')
  await expect(appId).toHaveAttribute('aria-invalid', 'false')
  await version.fill('1.0')
  await expect(version).toHaveAttribute('aria-invalid', 'true')
  await expect(submit).toBeDisabled()
  await version.fill('1.2.3')
  await expect(version).toHaveAttribute('aria-invalid', 'false')
  await expect(submit).toBeEnabled()

  const previewSpawnCount = await page.evaluate(
    () =>
      ((window as TauriWindow).__OP_PREVIEW_SPAWNS__ ?? []).filter((entry) => {
        const args = (entry as { args?: unknown }).args
        return !(
          Array.isArray(args) &&
          args.includes('--packaging') &&
          args.includes('microfrontend')
        )
      }).length
  )
  await submit.click()
  await expect(page.getByTestId('lowcode-microfrontend-export-success')).toContainText(
    'Microfrontend ready'
  )
  await expect(page.getByTestId('lowcode-microfrontend-export-success')).toContainText(
    '/tmp/openpencil-mfe-output'
  )

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          ((window as TauriWindow).__OP_PREVIEW_SPAWNS__ ?? []).filter((entry) => {
            const args = (entry as { args?: unknown }).args
            return (
              Array.isArray(args) && args.includes('--packaging') && args.includes('microfrontend')
            )
          }).length
      )
    )
    .toBe(1)
  const buildArgs = await page.evaluate(() => {
    const entry = ((window as TauriWindow).__OP_PREVIEW_SPAWNS__ ?? []).find((candidate) => {
      const args = (candidate as { args?: unknown }).args
      return Array.isArray(args) && args.includes('--packaging') && args.includes('microfrontend')
    })
    return (entry as { args?: unknown } | undefined)?.args
  })
  expect(Array.isArray(buildArgs)).toBe(true)
  if (!Array.isArray(buildArgs)) throw new Error('Expected a microfrontend build argv')
  const flagValue = (flag: string) => buildArgs[buildArgs.indexOf(flag) + 1]
  expect(buildArgs[1]).toBe('build')
  expect(flagValue('--packaging')).toBe('microfrontend')
  expect(flagValue('--app-id')).toBe('openpencil.checkout')
  expect(flagValue('--app-version')).toBe('1.2.3')
  expect(flagValue('--target')).toBe('react')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          ((window as TauriWindow).__OP_PREVIEW_SPAWNS__ ?? []).filter((entry) => {
            const args = (entry as { args?: unknown }).args
            return !(
              Array.isArray(args) &&
              args.includes('--packaging') &&
              args.includes('microfrontend')
            )
          }).length
      )
    )
    .toBe(previewSpawnCount)
  await page.getByRole('button', { name: 'Close microfrontend export' }).click()
  await expect(dialog).toHaveCount(0)

  await codePenShowcase.click()
  const codePenDialog = page.getByTestId('lowcode-codepen-showcase-dialog')
  await expect(codePenDialog).toBeVisible()
  await expect(page.getByTestId('lowcode-codepen-title')).toHaveValue('Untitled')
  await page.getByTestId('lowcode-codepen-prepare').click()
  await expect(codePenDialog).toContainText('Safety checks passed')
  await expect(page.getByTestId('lowcode-codepen-open')).toBeDisabled()
  await page.getByTestId('lowcode-codepen-confirm').check()
  await page.getByTestId('lowcode-codepen-open').click()
  await expect(codePenDialog).toContainText('Safety checks passed')
  await expect
    .poll(() => page.evaluate(() => (window as TauriWindow).__OP_CODEPEN_PREFILLS__?.length ?? 0))
    .toBe(1)
  const prefill = await page.evaluate(() => (window as TauriWindow).__OP_CODEPEN_PREFILLS__?.at(0))
  expect(prefill).toMatchObject({
    data: {
      title: 'Untitled',
      html_pre_processor: 'none',
      css_pre_processor: 'none',
      js_pre_processor: 'none'
    }
  })
  await page.getByRole('button', { name: 'Close CodePen showcase' }).click()
  await expect(codePenDialog).toHaveCount(0)

  await page.getByTestId('lowcode-preview-settings-toggle').click()
  await page.getByTestId('lowcode-preview-i18n').check()
  await page.keyboard.press('Escape')
  await microfrontendExport.click()
  await expect(dialog).toContainText('does not isolate the i18n runtime yet')
  await expect(submit).toBeDisabled()
  await page.getByRole('button', { name: 'Close microfrontend export' }).click()
  await page.getByTestId('lowcode-preview-settings-toggle').click()
  await page.getByTestId('lowcode-preview-i18n').uncheck()
  await page.keyboard.press('Escape')

  await page.getByTestId('lowcode-deploy-toggle').click()
  await expect(page.getByTestId('lowcode-deploy-panel')).toBeVisible()
  const deployBox = await page.getByTestId('lowcode-deploy-panel').boundingBox()
  if (!deployBox) throw new Error('Expected the deploy popover to have a bounding box')
  expect(deployBox.x + deployBox.width).toBeLessThanOrEqual(3200)
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 2200, height: 900 })
  await expect(toolbar).toHaveAttribute('data-band', 'medium')
  await expect.poll(fits).toBe(true)

  await page.setViewportSize({ width: 1300, height: 800 })
  await expect(toolbar).toHaveAttribute('data-band', 'narrow')
  await expect.poll(fits).toBe(true)
  await expect(page.getByTestId('lowcode-preview-close')).toBeVisible()

  await page.setViewportSize({ width: 1000, height: 800 })
  await expect(toolbar).toHaveAttribute('data-band', 'tiny')
  await expect.poll(fits).toBe(true)
  await expect(page.getByTestId('lowcode-microfrontend-export-toggle')).toHaveCount(0)
  await expect(page.getByTestId('lowcode-codepen-showcase-toggle')).toHaveCount(0)
  await expect(page.getByTestId('lowcode-preview-popout-toggle')).toHaveCount(0)
  await page.getByTestId('lowcode-preview-more-toggle').click()
  const moreMenu = page.getByTestId('lowcode-preview-more-menu')
  const tinyPopout = page.getByTestId('lowcode-preview-more-popout')
  await expect(tinyPopout).toBeVisible()
  await expect(tinyPopout).toContainText('Open preview window')
  await tinyPopout.click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          ((window as TauriWindow).__OP_PREVIEW_WINDOW_INVOCATIONS__ ?? []).filter(
            (invocation) => invocation.command === 'open_preview_window'
          ).length
      )
    )
    .toBe(1)
  await expect.poll(fits).toBe(true)
  await page.getByTestId('lowcode-preview-more-toggle').click()
  await expect(moreMenu).toContainText('Export microfrontend…')
  await expect(moreMenu).toContainText('Open in CodePen…')
  await moreMenu.getByText('Export microfrontend…', { exact: true }).click()
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Close microfrontend export' }).click()
  await expect.poll(fits).toBe(true)
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
