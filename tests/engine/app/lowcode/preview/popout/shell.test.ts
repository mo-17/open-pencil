import { describe, expect, test } from 'bun:test'

import { DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS } from '@/app/lowcode/preview-pane/popout/controls'
import {
  createCompilerPreviewPopoutShellController,
  type CompilerPreviewPopoutView
} from '@/app/lowcode/preview-popout/controller'
import {
  installCompilerPreviewPopoutReceiver,
  requestCompilerPreviewPopoutLatestPayload,
  type CompilerPreviewPopoutGlobalTarget
} from '@/app/lowcode/preview-popout/globals'
import { parseCompilerPreviewPopoutPayload } from '@/app/lowcode/preview-popout/payload'

function payload(
  revision: number,
  overrides: Partial<{
    url: string
    port: number
    path: string
    controls: typeof DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS
  }> = {}
) {
  return {
    url: 'http://127.0.0.1:60140/',
    port: 60_140,
    path: '/orders',
    controls: DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS,
    revision,
    ...overrides
  }
}

function viewHarness() {
  const loaded: string[] = []
  const navigated: Array<Readonly<{ origin: string; path: string }>> = []
  const appliedControls: Array<typeof DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS> = []
  let reloads = 0
  const view: CompilerPreviewPopoutView = {
    loadSource(destination) {
      loaded.push(destination)
    },
    navigate(origin, path) {
      navigated.push({ origin, path })
    },
    applyControls(controls) {
      appliedControls.push(controls)
    },
    reload() {
      reloads++
    }
  }
  return { loaded, navigated, appliedControls, reloads: () => reloads, view }
}

describe('compiler preview popout native payload', () => {
  test('accepts an exact request with a positive safe revision', () => {
    expect(parseCompilerPreviewPopoutPayload(payload(1))).toEqual(payload(1))
  })

  test('rejects unknown fields, invalid revisions, and unsafe destinations', () => {
    for (const value of [
      { ...payload(1), extra: true },
      payload(0),
      payload(1.5),
      payload(Number.MAX_SAFE_INTEGER + 1),
      payload(1, { url: 'http://example.com:60140/' }),
      payload(1, { port: 60_141 }),
      payload(1, { path: '/orders?admin=1' }),
      { ...payload(1), controls: { ...DEFAULT_COMPILER_PREVIEW_POPOUT_CONTROLS, extra: true } },
      { ...payload(1), controls: { toolbar: true } }
    ]) {
      expect(() => parseCompilerPreviewPopoutPayload(value)).toThrow()
    }
  })
})

describe('compiler preview popout shell controller', () => {
  test('loads on first state and origin changes, but bridges same-origin routes', () => {
    const harness = viewHarness()
    const controller = createCompilerPreviewPopoutShellController(harness.view)

    expect(controller.update(payload(1))).toBe('loaded')
    expect(controller.update(payload(2, { path: '/customers' }))).toBe('navigated')
    expect(controller.update(payload(3, { path: '/customers' }))).toBe('unchanged')
    expect(
      controller.update(
        payload(4, {
          url: 'http://127.0.0.1:60141/',
          port: 60_141,
          path: '/customers'
        })
      )
    ).toBe('loaded')

    expect(harness.loaded).toEqual([
      'http://127.0.0.1:60140/orders',
      'http://127.0.0.1:60141/customers'
    ])
    expect(harness.navigated).toEqual([{ origin: 'http://127.0.0.1:60140', path: '/customers' }])
    expect(harness.appliedControls).toHaveLength(4)
    expect(controller.snapshot()?.revision).toBe(4)
  })

  test('ignores stale or duplicate revisions without touching the iframe', () => {
    const harness = viewHarness()
    const controller = createCompilerPreviewPopoutShellController(harness.view)
    controller.update(payload(5))

    expect(controller.update(payload(4, { path: '/stale' }))).toBe('ignored')
    expect(controller.update(payload(5, { path: '/duplicate' }))).toBe('ignored')

    expect(harness.loaded).toEqual(['http://127.0.0.1:60140/orders'])
    expect(harness.navigated).toEqual([])
    expect(harness.appliedControls).toHaveLength(1)
    expect(controller.snapshot()?.path).toBe('/orders')
  })

  test('applies control-only updates and reloads only after validated state exists', () => {
    const harness = viewHarness()
    const controller = createCompilerPreviewPopoutShellController(harness.view)
    expect(controller.reload()).toBe(false)

    controller.update(payload(1))
    expect(
      controller.update(
        payload(2, {
          controls: {
            toolbar: false,
            reload: false,
            focusEditor: false,
            alwaysOnTop: false,
            diagnostics: false,
            exportMicrofrontend: false,
            deploy: false
          }
        })
      )
    ).toBe('unchanged')
    expect(harness.appliedControls.at(-1)?.toolbar).toBe(false)
    expect(controller.reload()).toBe(true)
    expect(harness.reloads()).toBe(1)
  })

  test('does not advance state when validation or the view operation fails', () => {
    const controller = createCompilerPreviewPopoutShellController({
      loadSource() {
        throw new Error('iframe unavailable')
      },
      navigate() {
        throw new Error('unexpected navigate')
      },
      applyControls() {
        // The failure under test comes from the subsequent iframe operation.
      },
      reload() {
        throw new Error('unexpected reload')
      }
    })

    expect(() => controller.update(payload(1))).toThrow('iframe unavailable')
    expect(controller.snapshot()).toBeNull()
    expect(() => controller.update(payload(2, { path: '/orders?unsafe=1' }))).toThrow()
    expect(controller.snapshot()).toBeNull()
  })
})

describe('compiler preview popout native globals', () => {
  test('installs synchronously, consumes startup values, and keeps native updates callable', () => {
    const revisions: number[] = []
    const target: CompilerPreviewPopoutGlobalTarget = {
      __OPENPENCIL_PREVIEW_POPOUT_INITIAL__: payload(1),
      __OPENPENCIL_PREVIEW_POPOUT_PENDING__: payload(2)
    }

    const dispose = installCompilerPreviewPopoutReceiver(target, (value) => {
      revisions.push(parseCompilerPreviewPopoutPayload(value).revision)
    })

    expect(revisions).toEqual([1, 2])
    expect('__OPENPENCIL_PREVIEW_POPOUT_INITIAL__' in target).toBe(false)
    expect('__OPENPENCIL_PREVIEW_POPOUT_PENDING__' in target).toBe(false)
    target.__OPENPENCIL_PREVIEW_POPOUT_UPDATE__?.(payload(3))
    expect(revisions).toEqual([1, 2, 3])

    dispose()
    expect(target.__OPENPENCIL_PREVIEW_POPOUT_UPDATE__).toBeUndefined()
  })

  test('cleanup cannot remove a receiver that a newer shell owner replaced', () => {
    const target: CompilerPreviewPopoutGlobalTarget = {}
    const dispose = installCompilerPreviewPopoutReceiver(target, () => undefined)
    const replacement = (): void => undefined
    target.__OPENPENCIL_PREVIEW_POPOUT_UPDATE__ = replacement

    dispose()

    expect(target.__OPENPENCIL_PREVIEW_POPOUT_UPDATE__).toBe(replacement)
  })

  test('requests latest native state after receiver install and lets revisions reject races', async () => {
    const harness = viewHarness()
    const controller = createCompilerPreviewPopoutShellController(harness.view)
    let resolveLatest!: (value: unknown) => void
    const latest = new Promise<unknown>((resolve) => {
      resolveLatest = resolve
    })

    const handshake = requestCompilerPreviewPopoutLatestPayload(
      () => latest,
      (value) => {
        controller.update(value)
      }
    )
    controller.update(payload(2, { path: '/newer' }))
    resolveLatest(payload(1, { path: '/older' }))
    await handshake

    expect(controller.snapshot()?.revision).toBe(2)
    expect(controller.snapshot()?.path).toBe('/newer')
    expect(harness.loaded).toEqual(['http://127.0.0.1:60140/newer'])
  })

  test('does not manufacture state when the popup-only native handshake rejects', async () => {
    let updates = 0
    await expect(
      requestCompilerPreviewPopoutLatestPayload(
        async () => {
          throw new Error('latest payload unavailable')
        },
        () => {
          updates++
        }
      )
    ).rejects.toThrow('latest payload unavailable')
    expect(updates).toBe(0)
  })
})

describe('compiler preview popout document boundary', () => {
  test('keeps the wrapper local and the compiler document sandboxed', async () => {
    const [html, main] = await Promise.all([
      Bun.file('preview-popout.html').text(),
      Bun.file('src/app/lowcode/preview-popout/main.ts').text()
    ])

    expect(html).toContain(
      'sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"'
    )
    expect(html).toContain('referrerpolicy="no-referrer"')
    // WebKit rejects wildcard ports on IP/localhost host sources. The CSP
    // therefore admits HTTP frames while native + shell parsers independently
    // restrict the only assigned iframe URL to canonical loopback origins.
    expect(html).toContain('frame-src http:')
    expect(html).not.toContain('allow-top-navigation')
    expect(html).not.toContain('allow-popups')
    expect(html).toContain('id="compiler-preview-reload"')
    expect(html).toContain('id="compiler-preview-focus-editor"')
    expect(html).toContain('id="compiler-preview-always-on-top"')
    expect(html).toContain('id="compiler-preview-more-menu"')
    expect(html).toContain('id="compiler-preview-diagnostics"')
    expect(html).toContain('id="compiler-preview-export-microfrontend"')
    expect(html).toContain('id="compiler-preview-deploy"')
    expect(html).not.toContain('role="menuitem"')
    expect(html.indexOf('id="compiler-preview-toolbar"')).toBeLessThan(
      html.indexOf('id="compiler-preview"')
    )
    expect(main).toContain("invoke('focus_preview_editor_window')")
    expect(main).toContain("invoke('set_preview_window_always_on_top', { enabled })")
    expect(main).toContain("invoke<unknown>('get_preview_window_latest_payload')")
    expect(main).toContain("invoke('send_preview_window_intent', { intent })")
    expect(main).toContain("previousFocus.closest('[hidden]')")
    expect(main).toContain('moreMenu.hidden || focusedMoreActionWasHidden')
    expect(main.indexOf('installCompilerPreviewPopoutReceiver(')).toBeLessThan(
      main.indexOf("invoke<unknown>('get_preview_window_latest_payload')")
    )
    expect(main).not.toContain("addEventListener('message'")
    expect(main).not.toContain('__TAURI_INTERNALS__')
    expect(main).not.toContain('localStorage')
    expect(main).not.toContain('location.search')
    expect(main).not.toContain('@open-pencil/compiler')
    expect(main).not.toContain('vue')
  })
})
