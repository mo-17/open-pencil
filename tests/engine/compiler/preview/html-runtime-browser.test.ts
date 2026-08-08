import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Page, type Request, type Response } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

declare global {
  interface Window {
    __openPencilHtmlExecuted?: boolean
  }
}

const REMOTE_ORIGIN = 'https://example.com'
const UNSAFE_HTML = `<style>
  body { margin: 0; background: #eff6ff; color: #172554; font: 20px system-ui; }
  main { padding: 20px; }
  .remote { background-image: url('${REMOTE_ORIGIN}/background.png'); }
</style>
<main id="visible-html" class="remote">
  <strong>Edited HTML is visible</strong>
  <a id="javascript-link" href="javascript:document.body.dataset.javascriptExecuted='yes'">Unsafe link</a>
  <img src="${REMOTE_ORIGIN}/tracker.png" onerror="document.body.dataset.eventExecuted='yes'">
</main>
<script>
  document.body.dataset.scriptExecuted = 'yes'
  window.parent.__openPencilHtmlExecuted = true
</script>`

function buildHtmlPreviewFiles(): Map<string, string | Uint8Array> {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const frame = graph.createNode('FRAME', pageId, {
    x: 24,
    y: 48,
    width: 520,
    height: 320,
    interactiveProps: {
      module: {
        version: 1,
        pluginId: 'open-pencil.html',
        moduleType: 'html',
        configVersion: 1,
        config: { html: UNSAFE_HTML }
      }
    }
  })
  graph.createNode('TEXT', frame.id, {
    text: 'Host overlay',
    x: 12,
    y: 280,
    width: 120,
    height: 24
  })

  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'html-runtime-browser', devMode: false })
  }).files
}

describe('preview browser — compiled HTML sandbox', () => {
  const timeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null
  let remoteRequests: string[] = []
  let remoteFailures: string[] = []
  let remoteResponses: string[] = []

  beforeEach(async () => {
    server = await createPreviewServer({ initialFiles: buildHtmlPreviewFiles() })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
    remoteRequests = []
    remoteFailures = []
    remoteResponses = []
    page.on('request', (request: Request) => {
      if (request.url().startsWith(REMOTE_ORIGIN)) remoteRequests.push(request.url())
    })
    page.on('response', (response: Response) => {
      if (response.url().startsWith(REMOTE_ORIGIN)) remoteResponses.push(response.url())
    })
    page.on('requestfailed', (request: Request) => {
      if (request.url().startsWith(REMOTE_ORIGIN)) {
        remoteFailures.push(request.failure()?.errorText ?? 'unknown')
      }
    })
  }, timeoutMs)

  afterEach(async () => {
    try {
      await page?.close()
    } finally {
      try {
        await browser?.close()
      } finally {
        await server?.close()
        page = null
        browser = null
        server = null
      }
    }
  }, timeoutMs)

  test(
    'shows authored HTML without executing scripts, event handlers, javascript URLs, or remote loads',
    async () => {
      if (!server || !page) throw new Error('Missing HTML preview runtime')
      await page.goto(server.url, { waitUntil: 'networkidle' })

      const iframe = page.getByTitle('HTML preview')
      await iframe.waitFor({ state: 'visible' })
      expect(await iframe.getAttribute('sandbox')).toBe('')
      expect(await iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
      expect(await iframe.getAttribute('tabindex')).toBe('-1')
      const sourceDocument = await iframe.getAttribute('srcdoc')
      expect(sourceDocument ?? '').toStartWith(
        '<!doctype html><meta http-equiv="Content-Security-Policy"'
      )
      expect(await iframe.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe(
        'none'
      )

      const preview = page.frameLocator('iframe[title="HTML preview"]')
      const visible = preview.locator('#visible-html')
      await visible.waitFor({ state: 'visible' })
      expect(await visible.textContent()).toContain('Edited HTML is visible')
      expect(await visible.evaluate((element) => getComputedStyle(element).fontSize)).toBe('20px')
      expect(await page.getByText('Host overlay').count()).toBe(1)

      await preview
        .locator('#javascript-link')
        .evaluate((element) => (element as HTMLAnchorElement).click())
      await page.waitForTimeout(100)
      expect(await visible.evaluate(() => document.body.dataset.scriptExecuted ?? null)).toBeNull()
      expect(await visible.evaluate(() => document.body.dataset.eventExecuted ?? null)).toBeNull()
      expect(
        await visible.evaluate(() => document.body.dataset.javascriptExecuted ?? null)
      ).toBeNull()
      expect(await page.evaluate(() => Boolean(window.__openPencilHtmlExecuted))).toBe(false)
      expect(remoteRequests).toHaveLength(2)
      expect(remoteFailures).toHaveLength(2)
      expect(remoteFailures).toEqual(['csp', 'csp'])
      expect(remoteResponses).toEqual([])
    },
    timeoutMs
  )
})
