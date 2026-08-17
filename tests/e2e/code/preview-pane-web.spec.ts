import { readFile } from 'node:fs/promises'
/* oxlint-disable eslint/max-lines -- One serial browser lifecycle covers Worker, iframe, font, and stale-result boundaries. */

import { expect, test, type Frame, type Page, type Request } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const PREVIEW_FRAME = 'iframe[aria-label="lowcode preview"]'
const CDN_FONT_FAMILY = 'OpenPencil CDN Fixture'
const FONTSOURCE_API_ROOT = 'https://api.fontsource.org/v1'
const FONTSOURCE_PINNED_URL =
  'https://cdn.jsdelivr.net/fontsource/fonts/open-pencil-cdn-fixture@1.2.3/latin-400-normal.ttf'

interface PinnedFontsourceFamily {
  family: string
  id: string
  version: string
  weights: readonly number[]
}

const CDN_FONT_FIXTURE: PinnedFontsourceFamily = {
  family: CDN_FONT_FAMILY,
  id: 'open-pencil-cdn-fixture',
  version: '1.2.3',
  weights: [400]
}

const SCREENSHOT_FONT_FIXTURES: readonly PinnedFontsourceFamily[] = [
  { family: 'Bebas Neue', id: 'bebas-neue', version: '5.3.0', weights: [400] },
  { family: 'Source Sans 3', id: 'source-sans-3', version: '5.3.0', weights: [400, 500, 700] }
]

interface FontsourceRequestRecord {
  headers: Record<string, string>
  method: string
  resourceType: string
  url: string
}

interface PinnedFontFixture {
  byteLength: number
  requests: FontsourceRequestRecord[]
}

function latestFontURL(family: PinnedFontsourceFamily, weight: number): string {
  return `https://cdn.jsdelivr.net/fontsource/fonts/${family.id}@latest/latin-${weight}-normal.ttf`
}

function pinnedFontURL(family: PinnedFontsourceFamily, weight: number): string {
  return `https://cdn.jsdelivr.net/fontsource/fonts/${family.id}@${family.version}/latin-${weight}-normal.ttf`
}

async function installPinnedFontsourceRoutes(
  page: Page,
  families: readonly PinnedFontsourceFamily[] = [CDN_FONT_FIXTURE]
): Promise<PinnedFontFixture> {
  const fontBytes = await readFile(new URL('../../../public/Inter-Regular.ttf', import.meta.url))
  const requests: FontsourceRequestRecord[] = []
  const pinnedAssets = new Set(
    families.flatMap((family) => family.weights.map((weight) => pinnedFontURL(family, weight)))
  )

  const recordRequest = async (networkRequest: Request) => {
    requests.push({
      headers: await networkRequest.allHeaders(),
      method: networkRequest.method(),
      resourceType: networkRequest.resourceType(),
      url: networkRequest.url()
    })
  }

  await page.route('https://api.fontsource.org/**', async (route) => {
    await recordRequest(route.request())
    const url = route.request().url()
    if (url === `${FONTSOURCE_API_ROOT}/fonts`) {
      await route.fulfill({
        body: JSON.stringify(
          families.map((family) => ({
            category: 'sans-serif',
            defSubset: 'latin',
            family: family.family,
            id: family.id,
            styles: ['normal'],
            subsets: ['latin'],
            variable: false,
            weights: family.weights
          }))
        ),
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        status: 200
      })
      return
    }
    const id = url.slice(`${FONTSOURCE_API_ROOT}/fonts/`.length)
    const family = families.find((candidate) => candidate.id === id)
    if (family && url === `${FONTSOURCE_API_ROOT}/fonts/${family.id}`) {
      await route.fulfill({
        body: JSON.stringify({
          family: family.family,
          id: family.id,
          npmVersion: family.version,
          unicodeRange: { latin: 'U+0000-00FF' },
          variants: Object.fromEntries(
            family.weights.map((weight) => [
              weight,
              { normal: { latin: { url: { ttf: latestFontURL(family, weight) } } } }
            ])
          )
        }),
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        status: 200
      })
      return
    }
    await route.fulfill({ body: 'Unexpected Fontsource fixture URL', status: 404 })
  })

  await page.route('https://cdn.jsdelivr.net/fontsource/fonts/**', async (route) => {
    await recordRequest(route.request())
    if (!pinnedAssets.has(route.request().url())) {
      await route.fulfill({ body: 'Unpinned or unexpected font asset URL', status: 404 })
      return
    }
    await route.fulfill({
      body: fontBytes,
      contentType: 'font/ttf',
      headers: { 'access-control-allow-origin': '*' },
      status: 200
    })
  })

  return { byteLength: fontBytes.byteLength, requests }
}

async function enableFontsourceAtStartup(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Test config must exist before app startup.
    window.localStorage.setItem('op-online-fonts-enabled', 'true')
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Test config must exist before app startup.
    window.localStorage.setItem(
      'op-font-providers',
      JSON.stringify({ bunny: false, fontshare: false, fontsource: true, google: false })
    )
  })
}

async function setMainThreadFontsourceEnabled(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(async (fontsourceEnabled) => {
    const fontModuleURL = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => url.includes('/packages/core/src/text/fonts.ts'))
    if (!fontModuleURL) throw new Error('Active font manager module not found')
    const { fontManager } = (await import(/* @vite-ignore */ fontModuleURL)) as {
      fontManager: {
        setOnlineFontProviders(providers: Record<string, boolean>): void
      }
    }
    fontManager.setOnlineFontProviders(fontsourceEnabled ? { fontsource: true } : {})
  }, enabled)
}

async function openWebEditor(page: Page): Promise<void> {
  await page.setViewportSize({ width: 2200, height: 900 })
  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
  expect(
    await page.evaluate(
      () => typeof (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    )
  ).toBe('undefined')
  await expect(page.getByTestId('lowcode-preview-pane')).toBeVisible()
}

async function waitForBrowserReady(page: Page): Promise<void> {
  const pane = page.getByTestId('lowcode-preview-pane')
  await expect(pane).toHaveAttribute('data-preview-host', 'browser-worker', { timeout: 60_000 })
  await expect(pane).toHaveAttribute('data-preview-status', 'ready', { timeout: 60_000 })
  await expect(page.locator(PREVIEW_FRAME)).toBeVisible()
}

async function reloadBrowserPreview(page: Page): Promise<void> {
  const inlineReload = page.getByTestId('lowcode-preview-reload')
  if (await inlineReload.isVisible()) {
    await inlineReload.click()
    return
  }
  await page.getByRole('button', { name: '↻', exact: true }).click()
}

async function createTextMarker(page: Page, text: string): Promise<string> {
  return page.evaluate((marker) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.graph.createNode('TEXT', store.state.currentPageId, {
      name: 'Browser preview E2E marker',
      text: marker,
      x: 32,
      y: 32,
      width: 480,
      height: 48,
      fontSize: 24
    }).id
  }, text)
}

async function updateTextMarker(page: Page, nodeId: string, text: string): Promise<void> {
  await page.evaluate(
    ({ id, marker }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      store.graph.updateNode(id, { text: marker })
    },
    { id: nodeId, marker: text }
  )
}

async function previewContentFrame(page: Page): Promise<Frame> {
  const handle = await page.locator(PREVIEW_FRAME).elementHandle()
  const frame = await handle?.contentFrame()
  if (!frame) throw new Error('Browser preview iframe is not attached')
  return frame
}

async function installPreviewSuccessReplayHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type ReplayState = typeof window & {
      __OP_CAPTURE_NEXT_PREVIEW_SUCCESS__?: boolean
      __OP_REPLAY_CAPTURED_PREVIEW_SUCCESS__?: (() => void) | null
    }
    const state = window as ReplayState
    const NativeWorker = window.Worker
    const nativeOnmessage = Object.getOwnPropertyDescriptor(NativeWorker.prototype, 'onmessage')
    if (typeof nativeOnmessage?.get !== 'function' || typeof nativeOnmessage.set !== 'function') {
      throw new TypeError('Native Worker.onmessage accessors are unavailable')
    }
    const getNativeOnmessage = nativeOnmessage.get
    const setNativeOnmessage = nativeOnmessage.set
    state.__OP_CAPTURE_NEXT_PREVIEW_SUCCESS__ = false
    state.__OP_REPLAY_CAPTURED_PREVIEW_SUCCESS__ = null

    function isReadyPreviewResponse(value: unknown): boolean {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
      const field = (record: object, key: string): unknown =>
        Object.getOwnPropertyDescriptor(record, key)?.value
      const result = field(value, 'result')
      return (
        field(value, 'version') === 3 &&
        field(value, 'type') === 'result' &&
        typeof field(value, 'requestId') === 'string' &&
        Number.isSafeInteger(field(value, 'generation')) &&
        typeof result === 'object' &&
        result !== null &&
        !Array.isArray(result) &&
        field(result, 'status') === 'ready' &&
        typeof field(result, 'html') === 'string'
      )
    }

    class PreviewSuccessReplayWorker extends NativeWorker {
      private assignedMessageHandler: Worker['onmessage'] = null

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options)
        if (options?.name !== 'openpencil-browser-preview') return
        this.addEventListener('message', (event) => {
          const handler = this.assignedMessageHandler
          if (
            !state.__OP_CAPTURE_NEXT_PREVIEW_SUCCESS__ ||
            !handler ||
            !isReadyPreviewResponse(event.data)
          ) {
            return
          }

          state.__OP_CAPTURE_NEXT_PREVIEW_SUCCESS__ = false
          const response = structuredClone(event.data)
          state.__OP_REPLAY_CAPTURED_PREVIEW_SUCCESS__ = () => {
            handler.call(
              this,
              new MessageEvent('message', {
                data: structuredClone(response)
              })
            )
          }

          // Hold this real, protocol-valid success until the test has cancelled
          // its host and published a newer error from a replacement host.
          event.stopImmediatePropagation()
        })
      }

      override get onmessage(): Worker['onmessage'] {
        return getNativeOnmessage.call(this) as Worker['onmessage']
      }

      override set onmessage(value: Worker['onmessage']) {
        this.assignedMessageHandler = value
        setNativeOnmessage.call(this, value)
      }
    }

    Object.defineProperty(window, 'Worker', {
      configurable: true,
      value: PreviewSuccessReplayWorker
    })
  })
}

test.describe('browser Worker compiler preview', () => {
  test('is visible, reaches Ready, updates from SceneGraph, and stays sandboxed', async ({
    page
  }) => {
    test.setTimeout(90_000)
    await openWebEditor(page)
    await waitForBrowserReady(page)

    const firstText = 'Browser Worker Preview First'
    const secondText = 'Browser Worker Preview Updated'
    const markerId = await createTextMarker(page, firstText)
    await expect(page.frameLocator(PREVIEW_FRAME).locator('body')).toContainText(firstText, {
      timeout: 60_000
    })

    await updateTextMarker(page, markerId, secondText)
    await expect(page.frameLocator(PREVIEW_FRAME).locator('body')).toContainText(secondText, {
      timeout: 60_000
    })
    await expect(page.frameLocator(PREVIEW_FRAME).locator('body')).not.toContainText(firstText)

    const iframe = page.locator(PREVIEW_FRAME)
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
    const editorURL = page.url()
    await page.evaluate(() => {
      document.documentElement.dataset.previewCredentialSentinel = 'editor-only-secret'
      // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Isolation probe only.
      window.localStorage.setItem('open-pencil:e2e-preview-secret', 'editor-only-secret')
    })

    const sandbox = await previewContentFrame(page)
    const isolation = await sandbox.evaluate(async (escapeURL) => {
      let parentDOM = false
      let parentDOMError = ''
      try {
        parentDOM =
          window.parent.document.documentElement.dataset.previewCredentialSentinel ===
          'editor-only-secret'
      } catch (error) {
        parentDOMError = error instanceof DOMException ? error.name : String(error)
      }

      let storageValue: string | null = null
      let storageError = ''
      try {
        // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Isolation probe only.
        storageValue = window.localStorage.getItem('open-pencil:e2e-preview-secret')
      } catch (error) {
        storageError = error instanceof DOMException ? error.name : String(error)
      }

      const popup = window.open('about:blank', 'open-pencil-preview-popup-probe')
      const popupBlocked = popup === null
      popup?.close()

      let topNavigationError = ''
      try {
        window.top?.location.assign(escapeURL)
      } catch (error) {
        topNavigationError = error instanceof DOMException ? error.name : String(error)
      }

      let fetchBlocked = false
      try {
        await fetch('https://example.com/open-pencil-preview-csp-probe')
      } catch {
        fetchBlocked = true
      }
      return {
        fetchBlocked,
        parentDOM,
        parentDOMError,
        popupBlocked,
        storageError,
        storageValue,
        topNavigationError
      }
    }, new URL('/__preview_escape_probe__', editorURL).href)

    expect(isolation).toMatchObject({
      fetchBlocked: true,
      parentDOM: false,
      parentDOMError: 'SecurityError',
      popupBlocked: true,
      storageError: 'SecurityError',
      storageValue: null,
      topNavigationError: 'SecurityError'
    })
    await page.waitForTimeout(100)
    expect(page.url()).toBe(editorURL)
  })

  test('renders image-heavy CSS with the four affected Fontsource faces', async ({ page }) => {
    test.setTimeout(120_000)
    const image = await readFile(
      new URL('../../../packages/demos/videos/toolbar.png', import.meta.url)
    )
    const fontFixture = await installPinnedFontsourceRoutes(page, SCREENSHOT_FONT_FIXTURES)
    await enableFontsourceAtStartup(page)
    const assetCount = 56
    const marker = 'Browser Preview Expanded CSS And Fonts Ready'
    const fontFaces = [
      { family: 'Bebas Neue', label: 'Bebas Neue Bold', weight: 700 },
      { family: 'Source Sans 3', label: 'Source Sans 3 Bold', weight: 700 },
      { family: 'Source Sans 3', label: 'Source Sans 3 Medium', weight: 500 },
      { family: 'Source Sans 3', label: 'Source Sans 3 Regular', weight: 400 }
    ] as const

    await openWebEditor(page)
    await waitForBrowserReady(page)
    const fontNodeIds = await page.evaluate(
      ({ bytes, count, faces, markerText }) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const sharedBytes = new Uint8Array(bytes)
        for (let index = 0; index < count; index++) {
          const imageHash = index.toString(16).padStart(64, '0')
          store.graph.images.set(imageHash, sharedBytes)
          store.graph.createNode('RECTANGLE', store.state.currentPageId, {
            name: `Expanded CSS image ${index}`,
            x: (index % 4) * 336,
            y: Math.floor(index / 4) * 176,
            width: 320,
            height: 160,
            fills: [
              {
                type: 'IMAGE',
                imageHash,
                imageScaleMode: 'FILL',
                color: { r: 0, g: 0, b: 0, a: 1 },
                opacity: 1,
                visible: true
              }
            ]
          })
        }
        const ids = faces.map(
          ({ family, label, weight }, index) =>
            store.graph.createNode('TEXT', store.state.currentPageId, {
              name: `Affected Fontsource face ${index + 1}`,
              text: label,
              x: 24,
              y: 728 + index * 48,
              width: 640,
              height: 40,
              fontFamily: family,
              fontSize: 24,
              fontWeight: weight
            }).id
        )
        store.graph.createNode('TEXT', store.state.currentPageId, {
          name: 'Expanded CSS preview marker',
          text: markerText,
          x: 24,
          y: 928,
          width: 640,
          height: 48,
          fontSize: 24
        })
        return ids
      },
      { bytes: [...image], count: assetCount, faces: fontFaces, markerText: marker }
    )

    const preview = page.frameLocator(PREVIEW_FRAME)
    await expect(preview.locator('body')).toContainText(marker, { timeout: 90_000 })
    await waitForBrowserReady(page)
    const expectedAssetURLs = SCREENSHOT_FONT_FIXTURES.flatMap((family) =>
      family.weights.map((weight) => pinnedFontURL(family, weight))
    ).sort()
    await expect
      .poll(
        () =>
          [
            ...new Set(
              fontFixture.requests
                .map((request) => request.url)
                .filter((url) => url.startsWith('https://cdn.jsdelivr.net/fontsource/fonts/'))
            )
          ].sort(),
        { timeout: 60_000 }
      )
      .toEqual(expectedAssetURLs)
    await expect(page.getByTestId('font-status-banner')).toHaveCount(0)

    const sandbox = await previewContentFrame(page)
    const expandedCSS = await sandbox.evaluate(
      async ({ faces, nodeIds }) => {
        await document.fonts.ready
        const stylesheet = [...document.querySelectorAll('style')]
          .map((style) => style.textContent ?? '')
          .join('\n')
        const registeredFaces = [...document.fonts].map((face) => ({
          family: face.family.replaceAll('"', ''),
          status: face.status,
          weight: face.weight
        }))
        return {
          byteLength: new TextEncoder().encode(stylesheet).byteLength,
          embeddedFonts: stylesheet.match(/data:font\/ttf;base64,/g)?.length ?? 0,
          embeddedImages: stylesheet.match(/data:image\/png;base64,/g)?.length ?? 0,
          faceStatuses: faces.map(({ family, weight }, index) => {
            const node = document.querySelector<HTMLElement>(
              `[data-node-id="${CSS.escape(nodeIds[index] ?? '')}"]`
            )
            const resolvedWeight = family === 'Bebas Neue' ? 400 : weight
            return {
              authoredFamily: node ? getComputedStyle(node).fontFamily : '',
              authoredWeight: node ? getComputedStyle(node).fontWeight : '',
              family,
              loaded: registeredFaces.some(
                (face) =>
                  face.family === family &&
                  face.status === 'loaded' &&
                  face.weight === String(weight)
              ),
              resolvedWeight,
              weight
            }
          })
        }
      },
      { faces: fontFaces, nodeIds: fontNodeIds }
    )
    expect(expandedCSS.byteLength).toBeGreaterThan(12 * 1024 * 1024)
    expect(expandedCSS.byteLength).toBeLessThan(32 * 1024 * 1024)
    expect(expandedCSS.embeddedFonts).toBeGreaterThanOrEqual(fontFaces.length)
    expect(expandedCSS.embeddedImages).toBe(assetCount)
    expect(expandedCSS.faceStatuses).toHaveLength(fontFaces.length)
    for (const [index, expectedFace] of fontFaces.entries()) {
      const status = expandedCSS.faceStatuses[index]
      expect(status).toMatchObject({
        authoredWeight: String(expectedFace.weight),
        family: expectedFace.family,
        loaded: true,
        resolvedWeight: expectedFace.family === 'Bebas Neue' ? 400 : expectedFace.weight,
        weight: expectedFace.weight
      })
      expect(status?.authoredFamily).toContain(expectedFace.family)
    }
    expect(fontFixture.byteLength).toBe(342_408)
    expect(
      fontFixture.requests.every(
        (request) =>
          request.method === 'GET' &&
          request.resourceType === 'fetch' &&
          request.headers.authorization === undefined &&
          request.headers.cookie === undefined &&
          request.headers.referer === undefined
      )
    ).toBe(true)
  })

  test('pins, downloads, and embeds an approved CDN font without iframe font network access', async ({
    page
  }) => {
    test.setTimeout(120_000)
    const fontFixture = await installPinnedFontsourceRoutes(page)
    await enableFontsourceAtStartup(page)
    await page.addInitScript(() => {
      if (window.top !== window) return
      const state = window as typeof window & { __OP_MAIN_THREAD_FONT_FETCHES__?: string[] }
      state.__OP_MAIN_THREAD_FONT_FETCHES__ = []
      const nativeFetch = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        let url: string
        if (typeof input === 'string') url = input
        else if (input instanceof URL) url = input.href
        else url = input.url
        if (
          url.startsWith('https://api.fontsource.org/') ||
          url.startsWith('https://cdn.jsdelivr.net/fontsource/fonts/')
        ) {
          state.__OP_MAIN_THREAD_FONT_FETCHES__?.push(url)
          throw new TypeError('Main-thread Fontsource fetch is disabled by the preview E2E')
        }
        return nativeFetch(input, init)
      }
    })
    await openWebEditor(page)
    await waitForBrowserReady(page)

    const marker = 'Browser Preview CDN Font'
    await setMainThreadFontsourceEnabled(page, false)
    const markerId = await page.evaluate(
      ({ family, text }) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        return store.graph.createNode('TEXT', store.state.currentPageId, {
          name: 'Browser preview CDN font marker',
          text,
          x: 32,
          y: 96,
          width: 480,
          height: 48,
          fontFamily: family,
          fontSize: 24,
          fontWeight: 400
        }).id
      },
      { family: CDN_FONT_FAMILY, text: marker }
    )

    const preview = page.frameLocator(PREVIEW_FRAME)
    await expect(preview.locator('body')).toContainText(marker, { timeout: 60_000 })
    await expect(page.getByTestId('lowcode-preview-pane')).toHaveAttribute(
      'data-preview-status',
      'ready'
    )
    expect(fontFixture.requests).toHaveLength(0)
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __OP_MAIN_THREAD_FONT_FETCHES__?: string[] })
            .__OP_MAIN_THREAD_FONT_FETCHES__ ?? []
      )
    ).toEqual([])

    // Re-enable the provider only after the editor-side font demand has settled, then explicitly
    // reload. Any routed Fontsource request below must therefore come from the production preview
    // Worker and its default createBrowserWebFontFetch(), not from this page's guarded fetch.
    await setMainThreadFontsourceEnabled(page, true)
    const iframeNetworkRequests: string[] = []
    page.on('request', (request) => {
      if (
        request.frame() !== page.mainFrame() &&
        (request.url().startsWith('https://api.fontsource.org/') ||
          request.url().startsWith('https://cdn.jsdelivr.net/fontsource/fonts/'))
      ) {
        iframeNetworkRequests.push(request.url())
      }
    })
    await reloadBrowserPreview(page)
    await expect
      .poll(() => fontFixture.requests.map((request) => request.url), { timeout: 60_000 })
      .toContain(FONTSOURCE_PINNED_URL)
    await waitForBrowserReady(page)

    const sandbox = await previewContentFrame(page)
    const embeddedFont = await sandbox.evaluate(
      async ({ family, id }) => {
        await document.fonts.ready
        const element = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)
        return {
          computedFamily: element ? getComputedStyle(element).fontFamily : '',
          loaded: [...document.fonts].some(
            (face) => face.family.includes(family) && face.status === 'loaded'
          ),
          remoteFontResourceURLs: performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .filter(
              (url) =>
                url.startsWith('https://api.fontsource.org/') ||
                url.startsWith('https://cdn.jsdelivr.net/fontsource/fonts/')
            ),
          styleContainsDataFontURL: [...document.querySelectorAll('style')].some((style) =>
            style.textContent?.includes('data:font/')
          ),
          styleContainsRemoteURL: [...document.querySelectorAll('style')].some((style) =>
            style.textContent?.includes('https://cdn.jsdelivr.net/')
          )
        }
      },
      { family: CDN_FONT_FAMILY, id: markerId }
    )

    expect(fontFixture.requests.map((request) => request.url)).toEqual([
      `${FONTSOURCE_API_ROOT}/fonts`,
      `${FONTSOURCE_API_ROOT}/fonts/open-pencil-cdn-fixture`,
      FONTSOURCE_PINNED_URL
    ])
    expect(fontFixture.byteLength).toBeGreaterThan(0)
    expect(
      fontFixture.requests.every(
        (request) =>
          request.method === 'GET' &&
          request.resourceType === 'fetch' &&
          request.headers.authorization === undefined &&
          request.headers.cookie === undefined &&
          request.headers.referer === undefined
      )
    ).toBe(true)
    expect(embeddedFont).toMatchObject({
      loaded: true,
      remoteFontResourceURLs: [],
      styleContainsDataFontURL: true,
      styleContainsRemoteURL: false
    })
    expect(embeddedFont.computedFamily).toContain(CDN_FONT_FAMILY)

    const updatedMarker = `${marker} From Cache`
    await updateTextMarker(page, markerId, updatedMarker)
    await expect(preview.locator('body')).toContainText(updatedMarker, { timeout: 60_000 })
    await page.waitForTimeout(100)
    await expect(page.getByTestId('lowcode-preview-pane')).toHaveAttribute(
      'data-preview-status',
      'ready'
    )
    expect(fontFixture.requests.map((request) => request.url)).toEqual([
      `${FONTSOURCE_API_ROOT}/fonts`,
      `${FONTSOURCE_API_ROOT}/fonts/open-pencil-cdn-fixture`,
      FONTSOURCE_PINNED_URL
    ])
    expect(iframeNetworkRequests).toEqual([])
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __OP_MAIN_THREAD_FONT_FETCHES__?: string[] })
            .__OP_MAIN_THREAD_FONT_FETCHES__ ?? []
      )
    ).toEqual([])
  })

  test('reports Vue as explicitly Unsupported in the browser host', async ({ page }) => {
    test.setTimeout(90_000)
    await openWebEditor(page)
    await page.getByTestId('lowcode-preview-target').selectOption('vue')

    const pane = page.getByTestId('lowcode-preview-pane')
    await expect(pane).toHaveAttribute('data-preview-host', 'browser-worker')
    await expect(pane).toHaveAttribute('data-preview-status', 'unsupported', {
      timeout: 60_000
    })
    await expect(pane).toContainText('Vue browser preview is not available')
    await expect(page.locator(PREVIEW_FRAME)).toHaveCount(0)
    expect(
      await page.evaluate(
        () =>
          typeof (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
      )
    ).toBe('undefined')
  })

  test('turns a sandbox runtime failure into structured Error state', async ({ page }) => {
    test.setTimeout(90_000)
    await openWebEditor(page)
    await waitForBrowserReady(page)

    const sandbox = await previewContentFrame(page)
    await sandbox.evaluate(() => {
      window.setTimeout(() => {
        throw new Error('Browser preview runtime E2E failure')
      }, 0)
    })

    const pane = page.getByTestId('lowcode-preview-pane')
    await expect(pane).toHaveAttribute('data-preview-status', 'error', { timeout: 10_000 })
    await expect(page.locator(PREVIEW_FRAME)).toHaveCount(0)
    await page.getByTestId('lowcode-preview-diagnostics-toggle').click()
    const diagnostics = page.getByTestId('lowcode-preview-diagnostics')
    await expect(diagnostics).toContainText('browser-preview-runtime-error')
    await expect(diagnostics).toContainText('Browser preview runtime E2E failure')
  })

  test('fails closed when the sandbox iframe navigates itself', async ({ page }) => {
    test.setTimeout(90_000)
    await openWebEditor(page)
    await waitForBrowserReady(page)

    const sandbox = await previewContentFrame(page)
    await sandbox.waitForLoadState('load')
    expect(await sandbox.evaluate(() => window.name)).toBe('')
    await sandbox.evaluate(() => {
      window.setTimeout(() => window.location.assign('about:blank'), 0)
    })

    const pane = page.getByTestId('lowcode-preview-pane')
    await expect(pane).toHaveAttribute('data-preview-status', 'error', { timeout: 10_000 })
    await expect(page.locator(PREVIEW_FRAME)).toHaveCount(0)
    await page.getByTestId('lowcode-preview-diagnostics-toggle').click()
    const diagnostics = page.getByTestId('lowcode-preview-diagnostics')
    await expect(diagnostics).toContainText('browser-preview-runtime-error')
    await expect(diagnostics).toContainText('sandbox document cannot replace')
  })

  test('keeps the latest error after a cancelled older success is replayed late', async ({
    page
  }) => {
    test.setTimeout(90_000)
    await installPreviewSuccessReplayHarness(page)
    await openWebEditor(page)
    await waitForBrowserReady(page)
    await page.getByTestId('lowcode-preview-refresh-policy').selectOption('realtime')

    await page.evaluate(() => {
      const state = window as typeof window & { __OP_CAPTURE_NEXT_PREVIEW_SUCCESS__?: boolean }
      state.__OP_CAPTURE_NEXT_PREVIEW_SUCCESS__ = true
    })
    const markerId = await createTextMarker(page, 'Older successful browser preview')
    await page.waitForFunction(
      () =>
        typeof (window as typeof window & { __OP_REPLAY_CAPTURED_PREVIEW_SUCCESS__?: unknown })
          .__OP_REPLAY_CAPTURED_PREVIEW_SUCCESS__ === 'function',
      undefined,
      { timeout: 60_000 }
    )

    await updateTextMarker(page, markerId, 'file:///Users/openpencil/browser-preview-secret')
    await page.getByTestId('lowcode-preview-target').selectOption('vue')
    const pane = page.getByTestId('lowcode-preview-pane')
    await expect(pane).toHaveAttribute('data-preview-status', 'unsupported', { timeout: 60_000 })
    await page.getByTestId('lowcode-preview-target').selectOption('react')
    await expect(pane).toHaveAttribute('data-preview-status', 'error', { timeout: 60_000 })
    await expect(page.locator(PREVIEW_FRAME)).toHaveCount(0)
    await page.getByTestId('lowcode-preview-diagnostics-toggle').click()
    const diagnostics = page.getByTestId('lowcode-preview-diagnostics')
    await expect(diagnostics).toContainText('browser-preview-local-path-detected')

    await page.evaluate(async () => {
      const state = window as typeof window & {
        __OP_REPLAY_CAPTURED_PREVIEW_SUCCESS__?: (() => void) | null
      }
      const replay = state.__OP_REPLAY_CAPTURED_PREVIEW_SUCCESS__
      if (!replay) throw new Error('No captured Browser Worker success is available to replay')
      state.__OP_REPLAY_CAPTURED_PREVIEW_SUCCESS__ = null
      replay()
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
    })

    await expect(pane).toHaveAttribute('data-preview-status', 'error')
    await expect(page.locator(PREVIEW_FRAME)).toHaveCount(0)
    await expect(diagnostics).toContainText('browser-preview-local-path-detected')
  })
})
