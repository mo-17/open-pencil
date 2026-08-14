import { describe, expect, test } from 'bun:test'

import { DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS } from '@/app/lowcode/preview-pane/popout/controls'
import {
  createCompilerPreviewPopoutController,
  type CompilerPreviewPopoutControllerOptions
} from '@/app/lowcode/preview-pane/popout/session'
import {
  MAX_COMPILER_PREVIEW_POPOUT_PATH_BYTES,
  parseCompilerPreviewPopoutPath,
  parseCompilerPreviewPopoutRequest,
  type CompilerPreviewPopoutRequest
} from '@/app/lowcode/preview-pane/popout/url'

const ROOT_URL = 'http://127.0.0.1:60140/'

type InvokeCall = Readonly<{
  command: string
  args?: Record<string, unknown>
}>

function requestFromCall(call: InvokeCall): CompilerPreviewPopoutRequest {
  const request = call.args?.request
  if (!request) throw new Error('native request is missing')
  return request as CompilerPreviewPopoutRequest
}

function previewRequest(path = '/orders'): CompilerPreviewPopoutRequest {
  return {
    url: ROOT_URL,
    port: 60_140,
    path,
    controls: DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS
  }
}

function openResult(path = '/orders') {
  return {
    label: 'lowcode-preview-popout',
    url: `${ROOT_URL.replace(/\/$/, '')}${path}`,
    action: 'created'
  }
}

function updateResult(path = '/orders') {
  return {
    label: 'lowcode-preview-popout',
    url: `${ROOT_URL.replace(/\/$/, '')}${path}`,
    action: 'navigated'
  }
}

function controllerHarness(
  resolve: (call: InvokeCall) => unknown = ({ command }) => {
    if (command === 'close_preview_window') return true
    return command === 'update_preview_window' ? updateResult() : openResult()
  }
) {
  const calls: InvokeCall[] = []
  let destroyed = (_event: { payload: { label: string } }): void => {
    throw new Error('destroyed listener was not installed')
  }
  let intent = (_event: { payload: unknown }): void => {
    throw new Error('intent listener was not installed')
  }
  const invoke: NonNullable<CompilerPreviewPopoutControllerOptions['invoke']> = async <T>(
    command: string,
    args?: Record<string, unknown>
  ) => {
    const call = { command, ...(args ? { args } : {}) }
    calls.push(call)
    return (await resolve(call)) as T
  }
  const listen: NonNullable<CompilerPreviewPopoutControllerOptions['listen']> = async (
    event,
    handler
  ) => {
    if (event === 'preview-window-destroyed') {
      destroyed = handler as (event: { payload: { label: string } }) => void
    } else {
      expect(event).toBe('preview-window-intent')
      intent = handler
    }
    return () => undefined
  }
  const controller = createCompilerPreviewPopoutController({
    isDesktop: () => true,
    invoke,
    listen
  })
  return {
    calls,
    controller,
    destroy(label = 'lowcode-preview-popout') {
      destroyed({ payload: { label } })
    },
    sendIntent(payload: unknown) {
      intent({ payload })
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve()
}

describe('compiler preview popout URL boundary', () => {
  test('accepts only the native compiler route grammar', () => {
    for (const path of ['/', '/orders', '/users/:id', '/files/*', '/v1/foo_bar~1.2-3']) {
      expect(parseCompilerPreviewPopoutPath(path)).toBe(path)
    }

    for (const path of [
      '',
      'orders',
      '//orders',
      '/orders//new',
      '/.',
      '/orders/../admin',
      '/orders?draft=1',
      '/orders#details',
      '/orders\\admin',
      '/订单',
      `/${'a'.repeat(MAX_COMPILER_PREVIEW_POPOUT_PATH_BYTES)}`
    ]) {
      expect(() => parseCompilerPreviewPopoutPath(path)).toThrow()
    }

    const maximum = `/${'a'.repeat(MAX_COMPILER_PREVIEW_POPOUT_PATH_BYTES - 1)}`
    expect(parseCompilerPreviewPopoutPath(maximum)).toBe(maximum)
  })

  test('revalidates the canonical sidecar root and declared port', () => {
    expect(parseCompilerPreviewPopoutRequest(previewRequest())).toEqual(previewRequest())
    expect(() =>
      parseCompilerPreviewPopoutRequest({
        url: 'http://example.com:60140/',
        port: 60_140,
        path: '/orders',
        controls: DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS
      })
    ).toThrow()
    expect(() =>
      parseCompilerPreviewPopoutRequest({
        url: ROOT_URL,
        port: 60_141,
        path: '/orders',
        controls: DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS
      })
    ).toThrow()
    expect(() =>
      parseCompilerPreviewPopoutRequest({ ...previewRequest(), unexpected: true })
    ).toThrow()
    expect(() =>
      parseCompilerPreviewPopoutRequest({
        ...previewRequest(),
        controls: { ...DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS, reload: 'yes' }
      })
    ).toThrow()
  })
})

describe('compiler preview popout session', () => {
  test('fails closed in the browser without importing or invoking Tauri', async () => {
    let invokeCount = 0
    const controller = createCompilerPreviewPopoutController({
      isDesktop: () => false,
      invoke: async <T>() => {
        invokeCount++
        return undefined as T
      }
    })
    controller.registerCompilerPreviewPopoutSession({
      getRequest: () => previewRequest(),
      handleIntent: async () => undefined
    })

    await expect(controller.openActiveCompilerPreviewPopout()).rejects.toThrow(
      'only available in the desktop app'
    )
    expect(invokeCount).toBe(0)
    expect(controller.compilerPreviewPopoutOpen.value).toBe(false)
    expect(controller.compilerPreviewPopoutBusy.value).toBe(false)
  })

  test('opens with an exact native request and syncs without calling open again', async () => {
    let current = previewRequest('/orders')
    const harness = controllerHarness(({ command }) => {
      if (command === 'open_preview_window') return openResult(current.path)
      if (command === 'update_preview_window') return updateResult(current.path)
      return true
    })
    harness.controller.registerCompilerPreviewPopoutSession({
      getRequest: () => current,
      handleIntent: async () => undefined
    })

    await harness.controller.openActiveCompilerPreviewPopout()
    expect(harness.controller.compilerPreviewPopoutOpen.value).toBe(true)
    expect(harness.calls[0]).toEqual({
      command: 'open_preview_window',
      args: { request: previewRequest('/orders') }
    })

    current = previewRequest('/customers')
    await harness.controller.syncActiveCompilerPreviewPopout()
    expect(harness.calls[1]).toEqual({
      command: 'update_preview_window',
      args: { request: previewRequest('/customers') }
    })
    expect(harness.calls.filter(({ command }) => command === 'open_preview_window')).toHaveLength(1)
  })

  test('queues a mid-open sync and re-reads the latest page and controls after open settles', async () => {
    let current = previewRequest('/orders')
    let releaseOpen!: (value: unknown) => void
    const harness = controllerHarness(({ command, args }) => {
      if (command === 'open_preview_window') {
        return new Promise<unknown>((resolve) => {
          releaseOpen = resolve
        })
      }
      if (command === 'update_preview_window') {
        const request = requestFromCall({ command, ...(args ? { args } : {}) })
        return updateResult(request.path)
      }
      return true
    })
    harness.controller.registerCompilerPreviewPopoutSession({
      getRequest: () => current,
      handleIntent: async () => undefined
    })

    const opening = harness.controller.openActiveCompilerPreviewPopout()
    await flushMicrotasks()
    current = {
      ...previewRequest('/customers'),
      controls: {
        toolbar: true,
        reload: false,
        focusEditor: false,
        alwaysOnTop: true,
        diagnostics: false,
        exportMicrofrontend: true,
        deploy: false
      }
    }
    const syncing = harness.controller.syncActiveCompilerPreviewPopout()
    expect(harness.calls.map(({ command }) => command)).toEqual(['open_preview_window'])

    releaseOpen(openResult('/orders'))
    await Promise.all([opening, syncing])

    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_preview_window',
      'update_preview_window'
    ])
    expect(requestFromCall(harness.calls[0])).toEqual(previewRequest('/orders'))
    expect(requestFromCall(harness.calls[1])).toEqual(current)
    expect(harness.controller.compilerPreviewPopoutOpen.value).toBe(true)
    expect(harness.controller.compilerPreviewPopoutBusy.value).toBe(false)
  })

  test('does not create a missing native window during sync', async () => {
    const harness = controllerHarness(({ command }) => {
      if (command === 'open_preview_window') return openResult()
      if (command === 'update_preview_window') return null
      return true
    })
    harness.controller.registerCompilerPreviewPopoutSession({
      getRequest: () => previewRequest(),
      handleIntent: async () => undefined
    })
    await harness.controller.openActiveCompilerPreviewPopout()

    await harness.controller.syncActiveCompilerPreviewPopout()

    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_preview_window',
      'update_preview_window'
    ])
    expect(harness.controller.compilerPreviewPopoutOpen.value).toBe(false)
  })

  test('rejects an inexact native result or a URL that differs from the request', async () => {
    for (const result of [
      { ...openResult(), extra: true },
      { ...openResult(), url: 'http://127.0.0.1:60140/admin' }
    ]) {
      const harness = controllerHarness(({ command }) =>
        command === 'open_preview_window' ? result : true
      )
      harness.controller.registerCompilerPreviewPopoutSession({
        getRequest: () => previewRequest(),
        handleIntent: async () => undefined
      })

      await expect(harness.controller.openActiveCompilerPreviewPopout()).rejects.toThrow(
        'invalid result'
      )
      expect(harness.controller.compilerPreviewPopoutOpen.value).toBe(false)
      expect(harness.controller.compilerPreviewPopoutBusy.value).toBe(false)
    }
  })

  test('serializes operations and reads each request only when its turn starts', async () => {
    let current = previewRequest('/one')
    let releaseFirst!: (value: unknown) => void
    let inFlight = 0
    let maximumInFlight = 0
    const harness = controllerHarness(async ({ command, args }) => {
      if (command !== 'open_preview_window') return true
      inFlight++
      maximumInFlight = Math.max(maximumInFlight, inFlight)
      const path = requestFromCall({ command, ...(args ? { args } : {}) }).path
      const result =
        path === '/one'
          ? await new Promise<unknown>((resolve) => {
              releaseFirst = resolve
            })
          : openResult(path)
      inFlight--
      return result
    })
    harness.controller.registerCompilerPreviewPopoutSession({
      getRequest: () => current,
      handleIntent: async () => undefined
    })

    const first = harness.controller.openActiveCompilerPreviewPopout()
    await flushMicrotasks()
    current = previewRequest('/two')
    const second = harness.controller.openActiveCompilerPreviewPopout()
    expect(harness.controller.compilerPreviewPopoutBusy.value).toBe(true)
    expect(harness.calls).toHaveLength(1)

    releaseFirst(openResult('/one'))
    await Promise.all([first, second])

    expect(maximumInFlight).toBe(1)
    expect(harness.calls.map((call) => requestFromCall(call).path)).toEqual(['/one', '/two'])
    expect(harness.controller.compilerPreviewPopoutBusy.value).toBe(false)
  })

  test('an old disposer cannot close a window now owned by a newer session', async () => {
    const harness = controllerHarness(({ command, args }) => {
      if (command === 'close_preview_window') return true
      const path = requestFromCall({ command, ...(args ? { args } : {}) }).path
      return openResult(path)
    })
    const disposeOld = harness.controller.registerCompilerPreviewPopoutSession({
      getRequest: () => previewRequest('/old'),
      handleIntent: async () => undefined
    })
    await harness.controller.openActiveCompilerPreviewPopout()
    const disposeNew = harness.controller.registerCompilerPreviewPopoutSession({
      getRequest: () => previewRequest('/new'),
      handleIntent: async () => undefined
    })
    await harness.controller.openActiveCompilerPreviewPopout()

    disposeOld()
    await flushMicrotasks()
    expect(harness.controller.compilerPreviewPopoutOpen.value).toBe(true)
    expect(harness.calls.some(({ command }) => command === 'close_preview_window')).toBe(false)

    disposeNew()
    await harness.controller.closeActiveCompilerPreviewPopout()
    expect(harness.calls.filter(({ command }) => command === 'close_preview_window')).toHaveLength(
      1
    )
    expect(harness.controller.compilerPreviewPopoutOpen.value).toBe(false)
  })

  test('tracks native destruction and disables future opens', async () => {
    const harness = controllerHarness()
    harness.controller.registerCompilerPreviewPopoutSession({
      getRequest: () => previewRequest(),
      handleIntent: async () => undefined
    })
    await flushMicrotasks()
    await harness.controller.openActiveCompilerPreviewPopout()

    harness.destroy('another-window')
    expect(harness.controller.compilerPreviewPopoutOpen.value).toBe(true)
    harness.destroy()
    expect(harness.controller.compilerPreviewPopoutOpen.value).toBe(false)

    await harness.controller.setCompilerPreviewPopoutDisabled(true)
    await expect(harness.controller.openActiveCompilerPreviewPopout()).rejects.toThrow('disabled')
    expect(harness.calls.filter(({ command }) => command === 'open_preview_window')).toHaveLength(1)
  })

  test('dispatches only exact intents to the active window owner', async () => {
    const handled: unknown[] = []
    const harness = controllerHarness()
    harness.controller.registerCompilerPreviewPopoutSession({
      getRequest: () => previewRequest(),
      handleIntent: async (intent) => {
        handled.push(intent)
      }
    })
    await flushMicrotasks()

    await harness.controller.dispatchCompilerPreviewPopoutIntent({ type: 'diagnostics' })
    expect(handled).toEqual([])
    await harness.controller.openActiveCompilerPreviewPopout()

    harness.sendIntent({ type: 'exportMicrofrontend' })
    await flushMicrotasks()
    expect(handled).toEqual([{ type: 'exportMicrofrontend' }])

    harness.sendIntent({ type: 'reload' })
    await flushMicrotasks()
    expect(handled).toHaveLength(1)
    expect(harness.controller.compilerPreviewPopoutError.value).toContain('supported type')
  })

  test('rechecks current host controls before dispatching an intent', async () => {
    const handled: unknown[] = []
    let current = previewRequest()
    const harness = controllerHarness()
    harness.controller.registerCompilerPreviewPopoutSession({
      getRequest: () => current,
      handleIntent: async (intent) => {
        handled.push(intent)
      }
    })
    await harness.controller.openActiveCompilerPreviewPopout()
    current = {
      ...current,
      controls: { ...current.controls, diagnostics: false }
    }

    await harness.controller.dispatchCompilerPreviewPopoutIntent({ type: 'diagnostics' })

    expect(handled).toEqual([])
    expect(harness.controller.compilerPreviewPopoutError.value).toContain('disabled')
  })

  test('disabling during an in-flight native open closes the window after open settles', async () => {
    let releaseOpen!: (value: unknown) => void
    const harness = controllerHarness(async ({ command }) => {
      if (command === 'open_preview_window') {
        return new Promise<unknown>((resolve) => {
          releaseOpen = resolve
        })
      }
      if (command === 'close_preview_window') return true
      return updateResult()
    })
    harness.controller.registerCompilerPreviewPopoutSession({
      getRequest: () => previewRequest(),
      handleIntent: async () => undefined
    })

    const opening = harness.controller.openActiveCompilerPreviewPopout()
    await flushMicrotasks()
    const disabling = harness.controller.setCompilerPreviewPopoutDisabled(true)
    expect(harness.calls.map(({ command }) => command)).toEqual(['open_preview_window'])

    releaseOpen(openResult())
    await Promise.all([opening, disabling])

    expect(harness.calls.map(({ command }) => command)).toEqual([
      'open_preview_window',
      'close_preview_window'
    ])
    expect(harness.controller.compilerPreviewPopoutOpen.value).toBe(false)
    expect(harness.controller.compilerPreviewPopoutBusy.value).toBe(false)
    await expect(harness.controller.openActiveCompilerPreviewPopout()).rejects.toThrow('disabled')
  })

  test('PreviewPane immediately maps plugin command availability to the session gate', async () => {
    const source = await Bun.file('src/app/lowcode/preview-pane/PreviewPane.vue').text()

    expect(source).toContain('void setCompilerPreviewPopoutDisabled(command === null)')
    expect(source).toMatch(
      /watch\(\s*compilerPreviewPopoutCommand,[\s\S]*?setCompilerPreviewPopoutDisabled\(command === null\)[\s\S]*?\{ immediate: true \}\s*\)/
    )
    expect(source).not.toContain('if (!command && compilerPreviewPopoutOpen.value)')
  })

  test('PreviewPane queues request synchronization while native open is busy', async () => {
    const source = await Bun.file('src/app/lowcode/preview-pane/PreviewPane.vue').text()

    expect(source).toContain(
      'if (compilerPreviewPopoutOpen.value || compilerPreviewPopoutBusy.value)'
    )
    expect(source).toMatch(
      /\[status, \(\) => store\.state\.currentPageId, compilerPreviewPopoutControls\][\s\S]*?compilerPreviewPopoutBusy\.value[\s\S]*?syncActiveCompilerPreviewPopout\(\)/
    )
  })

  test('settles a failed open without creating an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (cause: unknown): void => {
      unhandled.push(cause)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const harness = controllerHarness(() => {
        throw new Error('native open failed')
      })
      harness.controller.registerCompilerPreviewPopoutSession({
        getRequest: () => previewRequest(),
        handleIntent: async () => undefined
      })

      await expect(harness.controller.openActiveCompilerPreviewPopout()).rejects.toThrow(
        'native open failed'
      )
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })

      expect(unhandled).toEqual([])
      expect(harness.controller.compilerPreviewPopoutBusy.value).toBe(false)
      expect(harness.controller.compilerPreviewPopoutError.value).toBe('native open failed')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('contains update failures so background sync callers do not reject', async () => {
    const harness = controllerHarness(({ command }) => {
      if (command === 'open_preview_window') return openResult()
      throw new Error('native update failed')
    })
    harness.controller.registerCompilerPreviewPopoutSession({
      getRequest: () => previewRequest(),
      handleIntent: async () => undefined
    })
    await harness.controller.openActiveCompilerPreviewPopout()

    await expect(harness.controller.syncActiveCompilerPreviewPopout()).resolves.toBeUndefined()

    expect(harness.controller.compilerPreviewPopoutOpen.value).toBe(true)
    expect(harness.controller.compilerPreviewPopoutBusy.value).toBe(false)
    expect(harness.controller.compilerPreviewPopoutError.value).toBe('native update failed')
  })
})
