import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const REQUEST_URL = 'https://request-gate.test/tasks'
const CHANGE_URL = 'https://request-gate.test/search'

function buildRequestGateFiles(): Map<string, string | Uint8Array> {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'result', name: 'result', type: 'object', defaultValue: {} }]
  })
  graph.createNode('BUTTON', pageId, {
    name: 'RequestButton',
    x: 24,
    y: 24,
    width: 180,
    height: 44,
    interactiveProps: { text: 'Run request' },
    events: {
      onClick: [
        {
          id: 'request',
          kind: 'apiCall',
          method: 'GET',
          url: REQUEST_URL,
          targetName: 'result'
        }
      ]
    }
  })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'request-gate-runtime' })
  }).files
}

function buildDebouncedChangeFiles(): Map<string, string | Uint8Array> {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'query', name: 'query', type: 'string', defaultValue: '' },
      { id: 'result', name: 'result', type: 'object', defaultValue: {} }
    ]
  })
  graph.createNode('INPUT', pageId, {
    name: 'Search',
    x: 24,
    y: 24,
    width: 220,
    height: 44,
    bindings: { value: { kind: 'docState', docStateName: 'query' } },
    events: {
      onChange: [
        {
          id: 'search-request',
          kind: 'apiCall',
          method: 'GET',
          url: `${CHANGE_URL}?q=\${$value}`,
          targetName: 'result'
        }
      ]
    }
  })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'request-debounce-runtime' })
  }).files
}

describe('preview browser — request single-flight gate', () => {
  const timeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({ initialFiles: buildRequestGateFiles() })
    browser = await chromium.launch()
    page = await browser.newPage()
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
    'same-tick double click starts one request and restores pending UI after settle',
    async () => {
      if (!server || !page) throw new Error('missing request-gate browser runtime')
      let requestCount = 0
      let releaseRequest: (() => void) | undefined
      const requestHeld = new Promise<void>((resolve) => {
        releaseRequest = resolve
      })
      await page.route(REQUEST_URL, async (route) => {
        requestCount += 1
        await requestHeld
        await route.fulfill({
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: '{"ok":true}'
        })
      })

      await page.goto(server.url, { waitUntil: 'networkidle' })
      await page.evaluate(() => {
        let now = Date.now()
        Date.now = () => now
        ;(
          window as Window & { __advanceRequestClock?: (ms: number) => void }
        ).__advanceRequestClock = (ms) => {
          now += ms
        }
      })
      const button = page.getByRole('button', { name: 'Run request' })
      await button.waitFor()
      const firstRequest = page.waitForRequest(REQUEST_URL)
      await button.evaluate((element) => {
        ;(element as HTMLButtonElement).click()
        ;(element as HTMLButtonElement).click()
      })
      await firstRequest
      await button.waitFor({ state: 'visible' })

      expect(requestCount).toBe(1)
      expect(await button.isDisabled()).toBe(true)
      expect(await button.getAttribute('aria-busy')).toBe('true')
      expect(await button.getAttribute('data-op-request-pending')).toBe('true')
      expect(await page.locator('.relative.min-h-screen').getAttribute('aria-busy')).toBe('true')

      releaseRequest?.()
      await button.waitFor({ state: 'attached' })
      await page.waitForFunction(
        () => !(document.querySelector('button') as HTMLButtonElement | null)?.disabled
      )
      expect(requestCount).toBe(1)
      expect(await button.getAttribute('aria-busy')).toBe('false')
      expect(await button.getAttribute('data-op-request-pending')).toBeNull()

      await button.click()
      await page.waitForTimeout(25)
      expect(requestCount).toBe(1)

      await page.evaluate(() => {
        ;(
          window as Window & { __advanceRequestClock?: (ms: number) => void }
        ).__advanceRequestClock?.(301)
      })
      const secondRequest = page.waitForRequest(REQUEST_URL)
      await button.click()
      await secondRequest
      expect(requestCount).toBe(2)
    },
    timeoutMs
  )

  test(
    'rapid controlled changes stay immediate while only the latest remote value runs',
    async () => {
      await server?.close()
      server = await createPreviewServer({ initialFiles: buildDebouncedChangeFiles() })
      if (!server || !page) throw new Error('missing request-debounce browser runtime')

      const urls: string[] = []
      let releaseFirst: (() => void) | undefined
      const firstHeld = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      await page.route(`${CHANGE_URL}*`, async (route) => {
        urls.push(route.request().url())
        if (urls.length === 1) await firstHeld
        await route.fulfill({
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: '{"ok":true}'
        })
      })

      await page.goto(server.url, { waitUntil: 'networkidle' })
      const input = page.getByRole('textbox')
      await input.fill('one')
      expect(await input.inputValue()).toBe('one')
      await page.waitForTimeout(100)
      expect(urls).toHaveLength(0)

      await page.waitForRequest((request) => request.url().includes('q=one'))
      await input.fill('two')
      await input.fill('three')
      expect(await input.inputValue()).toBe('three')
      await page.waitForTimeout(300)
      expect(urls).toHaveLength(1)

      const latestRequest = page.waitForRequest((request) => request.url().includes('q=three'))
      releaseFirst?.()
      await latestRequest
      await page.waitForTimeout(50)
      expect(urls).toHaveLength(2)
      expect(urls[0]).toContain('q=one')
      expect(urls[1]).toContain('q=three')
      expect(urls.some((url) => url.includes('q=two'))).toBe(false)
    },
    timeoutMs
  )
})
