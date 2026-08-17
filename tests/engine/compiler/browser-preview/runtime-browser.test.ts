import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { chromium, type Browser } from '@playwright/test'

import { buildBrowserPreview } from '@open-pencil/compiler/browser-preview'

import { browserPreviewInput, compileBrowserPreviewFixture } from './helpers'

interface BrowserPreviewRuntimeWindow extends Window {
  __previewResult?: {
    channel: unknown
    origin: string
    portCount: number
    sourceMatches: boolean
  }
  __previewPort?: MessagePort
  __previewPortMessages?: Array<Record<string, unknown>>
  __previewWindowMessages?: Array<Record<string, unknown>>
  __previewURL?: string
}

interface NavigationProbeWindow extends Window {
  __navigationProbe?: {
    inheritedPort: boolean
    name: string
    received: unknown[]
  }
}

describe('compiler browser preview runtime', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser.close()
  })

  test('runs bundled React in a script-only sandbox and emits a channel-bound ready event', async () => {
    const marker = 'Browser preview runtime marker'
    const built = await buildBrowserPreview(
      await browserPreviewInput(compileBrowserPreviewFixture(marker), { bundleReact: true })
    )
    expect(built.status).toBe('ready')
    if (built.status !== 'ready') return

    const page = await browser.newPage()
    const browserErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    page.on('pageerror', (error) => browserErrors.push(error.message))
    await page.route('https://preview.test/host', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><div id="mount"></div></body></html>'
      })
    })
    await page.route('https://navigation.test/capture', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><script>
          const inheritedPort = window.__openPencilPreviewPort
          window.__navigationProbe = {
            inheritedPort: inheritedPort instanceof MessagePort,
            name: window.name,
            received: []
          }
          if (inheritedPort instanceof MessagePort) {
            inheritedPort.addEventListener('message', (event) => {
              window.__navigationProbe.received.push(event.data)
            })
            inheritedPort.start()
          }
          window.addEventListener('message', (event) => {
            window.__navigationProbe.received.push(event.data)
          })
        </script></body></html>`
      })
    })
    await page.goto('https://preview.test/host')
    await page.evaluate(
      ({ channel, html }) => {
        const iframe = document.createElement('iframe')
        iframe.id = 'preview'
        iframe.sandbox.add('allow-scripts')
        iframe.name = JSON.stringify({
          protocol: 'open-pencil-preview-v2',
          channel,
          parentOrigin: location.origin,
          transport: 'message-port'
        })
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        iframe.src = url
        const state = window as BrowserPreviewRuntimeWindow
        state.__previewURL = url
        state.__previewWindowMessages = []
        window.addEventListener('message', (event) => {
          if (event.data?.source === 'op-lowcode-preview') {
            state.__previewWindowMessages?.push(event.data)
          }
          if (event.data?.type !== 'ready') return
          if (event.ports.length === 1) {
            state.__previewPort = event.ports[0]
            state.__previewPortMessages = []
            event.ports[0].addEventListener('message', (portEvent) => {
              state.__previewPortMessages?.push(portEvent.data)
            })
            event.ports[0].start()
          }
          state.__previewResult = {
            channel: event.data.channel,
            origin: event.origin,
            portCount: event.ports.length,
            sourceMatches: event.source === iframe.contentWindow
          }
        })
        document.querySelector('#mount')?.appendChild(iframe)
      },
      { channel: 'browser_preview_test_channel_0001', html: built.html }
    )

    const frame = page.frames().find((candidate) => candidate !== page.mainFrame())
    expect(frame).toBeDefined()
    await frame?.getByText(marker).waitFor()
    await page.waitForFunction(() =>
      Boolean((window as BrowserPreviewRuntimeWindow).__previewResult)
    )
    const event = await page.evaluate(() => (window as BrowserPreviewRuntimeWindow).__previewResult)
    expect(event).toEqual({
      channel: 'browser_preview_test_channel_0001',
      origin: 'null',
      portCount: 1,
      sourceMatches: true
    })

    await page.evaluate(() => {
      const state = window as BrowserPreviewRuntimeWindow
      state.__previewPort?.postMessage({
        source: 'op-lowcode-editor',
        channel: 'browser_preview_test_channel_0001',
        type: 'theme',
        theme: 'dark'
      })
    })
    await frame?.locator('html[data-theme="dark"]').waitFor()
    await frame?.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'post-ready runtime failure' }))
    })
    await page.waitForFunction(() =>
      ((window as BrowserPreviewRuntimeWindow).__previewPortMessages ?? []).some(
        (message) => message.type === 'runtimeError'
      )
    )
    expect(
      await page.evaluate(() => (window as BrowserPreviewRuntimeWindow).__previewPortMessages)
    ).toContainEqual({
      source: 'op-lowcode-preview',
      channel: 'browser_preview_test_channel_0001',
      type: 'runtimeError',
      message: 'post-ready runtime failure'
    })
    expect(
      await page.evaluate(() =>
        (window as BrowserPreviewRuntimeWindow).__previewWindowMessages?.filter(
          (message) => message.type === 'runtimeError'
        )
      )
    ).toEqual([])
    await page.evaluate(() => {
      const iframe = document.querySelector<HTMLIFrameElement>('#preview')
      iframe?.contentWindow?.postMessage(
        {
          source: 'op-lowcode-editor',
          channel: 'browser_preview_test_channel_0001',
          type: 'theme',
          theme: 'light'
        },
        '*'
      )
    })
    await page.waitForTimeout(50)
    expect(await frame?.locator('html').getAttribute('data-theme')).toBe('dark')

    const parentDOMAccess = await frame?.evaluate(() => {
      try {
        return window.parent.document.body.textContent
      } catch (error) {
        return error instanceof DOMException ? error.name : 'blocked'
      }
    })
    expect(parentDOMAccess).toBe('SecurityError')
    expect(browserErrors).toEqual([])

    await frame?.evaluate(() => {
      location.href = 'https://navigation.test/capture'
    })
    await frame?.waitForURL('https://navigation.test/capture')
    await frame?.waitForFunction(() => Boolean((window as NavigationProbeWindow).__navigationProbe))
    await page.evaluate(() => {
      ;(window as BrowserPreviewRuntimeWindow).__previewPort?.postMessage({
        source: 'op-lowcode-editor',
        channel: 'browser_preview_test_channel_0001',
        type: 'docState',
        name: 'sharedValue',
        value: 'must-not-leak-after-navigation'
      })
    })
    await page.waitForTimeout(50)
    expect(
      await frame?.evaluate(() => (window as NavigationProbeWindow).__navigationProbe)
    ).toEqual({ inheritedPort: false, name: '', received: [] })

    await page.evaluate(() => {
      const state = window as BrowserPreviewRuntimeWindow
      state.__previewPort?.close()
      if (state.__previewURL) URL.revokeObjectURL(state.__previewURL)
      document.querySelector('#preview')?.remove()
    })
    await page.close()
  }, 30_000)
})
