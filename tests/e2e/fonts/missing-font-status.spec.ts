import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

interface FontLoadTestState {
  attempts: number
  requests: string[]
  release(): void
}

interface FontLoadMockOptions {
  family: string
  deferredStyle: string
  deferredStyleAttempt: number
  failedLoadsByStyle?: Record<string, number>
  unavailableStyles?: string[]
}

async function installFontLoadMock(page: Page, options: FontLoadMockOptions) {
  await page.addInitScript((options) => {
    const {
      family,
      deferredStyle,
      deferredStyleAttempt,
      failedLoadsByStyle = {},
      unavailableStyles = []
    } = options
    let releaseFont: (() => void) | undefined
    const fontGate = new Promise<void>((resolve) => {
      releaseFont = resolve
    })
    const state: FontLoadTestState = {
      attempts: 0,
      requests: [],
      release: () => releaseFont?.()
    }
    Object.defineProperty(window, '__OPENPENCIL_DEFERRED_FONT__', {
      configurable: true,
      value: state
    })

    let callbackId = 1
    const callbacks = new Map<number, unknown>()
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        callbacks,
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { label: 'main' }
        },
        convertFileSrc: (filePath: string) => filePath,
        invoke: async (command: string, args?: Record<string, unknown>) => {
          switch (command) {
            case 'list_system_fonts':
              return [{ family, styles: ['Regular'] }]
            case 'load_system_font': {
              if (args?.family !== family) return null
              const style = typeof args.style === 'string' ? args.style : 'Regular'
              state.attempts++
              state.requests.push(style)
              const styleAttempt = state.requests.filter((request) => request === style).length
              if (unavailableStyles.includes(style)) return null
              if (styleAttempt <= (failedLoadsByStyle[style] ?? 0)) return null
              if (style === deferredStyle && styleAttempt === deferredStyleAttempt) await fontGate
              const response = await fetch('/Inter-Regular.ttf')
              return response.arrayBuffer()
            }
            case 'take_pending_open':
              return []
            case 'plugin:event|listen':
            case 'plugin:event|unlisten':
              return null
            default:
              return null
          }
        },
        transformCallback: (callback: unknown) => {
          const id = callbackId++
          callbacks.set(id, callback)
          return id
        },
        unregisterCallback: (id: number) => {
          callbacks.delete(id)
        },
        runCallback: () => null
      }
    })
  }, options)
}

async function disableOnlineFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const modulePath = '/src/app/editor/fonts/index.ts'
    const { onlineFontsEnabled } = (await import(modulePath)) as {
      onlineFontsEnabled: { value: boolean }
    }
    onlineFontsEnabled.value = false
    await Promise.resolve()
  })
}

function fontLoadAttempts(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as Window & { __OPENPENCIL_DEFERRED_FONT__: FontLoadTestState })
        .__OPENPENCIL_DEFERRED_FONT__.attempts
  )
}

function fontLoadRequests(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as Window & { __OPENPENCIL_DEFERRED_FONT__: FontLoadTestState })
        .__OPENPENCIL_DEFERRED_FONT__.requests
  )
}

function releaseFontLoad(page: Page): Promise<void> {
  return page.evaluate(() => {
    const win = window as Window & { __OPENPENCIL_DEFERRED_FONT__: FontLoadTestState }
    win.__OPENPENCIL_DEFERRED_FONT__.release()
  })
}

test('does not report a local font as missing while its bytes are still loading', async ({
  page
}) => {
  await installFontLoadMock(page, {
    family: 'Bebas Neue',
    deferredStyle: 'Regular',
    deferredStyleAttempt: 1
  })
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await disableOnlineFonts(page)

  const textId = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('TEXT', 120, 120, 240, 40)
    store.updateNode(id, {
      text: 'Deferred local font',
      fontFamily: 'Bebas Neue'
    })
    store.select([id])
    return id
  })

  await expect.poll(() => fontLoadAttempts(page)).toBe(1)
  await expect.poll(() => fontLoadRequests(page)).toEqual(['Regular'])
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )

  const typography = page.getByRole('region', { name: 'Typography' })
  await expect(typography).toBeVisible()
  await expect(
    typography.getByRole('button', { name: 'Reload missing font: Bebas Neue' })
  ).toHaveCount(0)

  await releaseFontLoad(page)
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const store = window.openPencil?.getStore?.()
        const node = store?.graph.getNode(id)
        return node ? store?.renderer?.nodeFontReadiness(node) : 'missing-node'
      }, textId)
    )
    .toBe('ready')
  await expect(
    typography.getByRole('button', { name: 'Reload missing font: Bebas Neue' })
  ).toHaveCount(0)
})

test('manually retries a confirmed missing font and refreshes the canvas', async ({ page }) => {
  await installFontLoadMock(page, {
    family: 'Retryable Sans',
    deferredStyle: 'Regular',
    deferredStyleAttempt: 2,
    failedLoadsByStyle: { Regular: 1 },
    unavailableStyles: ['Bold']
  })
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await disableOnlineFonts(page)

  const textId = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('TEXT', 120, 120, 240, 40)
    store.updateNode(id, {
      text: 'Manual font retry',
      fontFamily: 'Retryable Sans',
      fontWeight: 700
    })
    store.select([id])
    return id
  })

  const retry = page.getByRole('button', {
    name: 'Reload missing font: Retryable Sans'
  })
  await expect(retry).toBeVisible()
  await expect.poll(() => fontLoadAttempts(page)).toBe(2)
  await expect.poll(() => fontLoadRequests(page)).toEqual(['Bold', 'Regular'])
  const renderVersionBeforeRetry = await page.evaluate(
    () => window.openPencil?.getStore?.()?.state.renderVersion ?? 0
  )

  await retry.click()
  await expect.poll(() => fontLoadAttempts(page)).toBe(4)
  await expect.poll(() => fontLoadRequests(page)).toEqual(['Bold', 'Regular', 'Bold', 'Regular'])
  await expect(retry).toHaveCount(0)

  await releaseFontLoad(page)
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const store = window.openPencil?.getStore?.()
        const node = store?.graph.getNode(id)
        return node
          ? {
              readiness: store?.renderer?.nodeFontReadiness(node),
              renderVersion: store?.state.renderVersion ?? 0
            }
          : null
      }, textId)
    )
    .toMatchObject({ readiness: 'ready' })
  await expect
    .poll(() => page.evaluate(() => window.openPencil?.getStore?.()?.state.renderVersion ?? 0))
    .toBeGreaterThan(renderVersionBeforeRetry)
  await expect(retry).toHaveCount(0)
})
