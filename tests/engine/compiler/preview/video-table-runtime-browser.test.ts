import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

declare global {
  interface Window {
    __openPencilTableExecuted?: boolean
  }
}

const MEDIA_ORIGIN = 'https://media.example.com'

function buildVideoAndTableFiles(devMode = false): Map<string, string | Uint8Array> {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const video = graph.createNode('FRAME', pageId, {
    name: 'Native video module',
    x: 24,
    y: 32,
    width: 420,
    height: 240,
    interactiveProps: {
      module: {
        version: 1,
        pluginId: 'open-pencil.video',
        moduleType: 'video',
        configVersion: 1,
        config: {
          src: `${MEDIA_ORIGIN}/demo.mp4`,
          poster: `${MEDIA_ORIGIN}/poster.webp`,
          controls: true,
          autoplay: true,
          muted: true,
          loop: true,
          fit: 'cover'
        }
      }
    }
  })
  graph.createNode('TEXT', video.id, { text: 'Video overlay', x: 12, y: 12 })

  const table = graph.createNode('FRAME', pageId, {
    name: 'Semantic table module',
    x: 24,
    y: 304,
    width: 520,
    height: 220,
    interactiveProps: {
      module: {
        version: 1,
        pluginId: 'open-pencil.table',
        moduleType: 'table',
        configVersion: 1,
        config: {
          table: {
            columns: ['Name', 'Status'],
            rows: [
              ['Compiler', 'Ready'],
              [
                '<img src=x onerror="window.parent.__openPencilTableExecuted=true">',
                '<script>window.parent.__openPencilTableExecuted=true</script>'
              ]
            ]
          },
          showHeader: true,
          striped: true,
          borderColor: '#CBD5E1',
          headerBackground: '#E2E8F0',
          textColor: '#0F172A',
          fontSize: 15
        }
      }
    }
  })
  graph.createNode('TEXT', table.id, { text: 'Table overlay', x: 12, y: 184 })

  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'video-table-runtime-browser', devMode })
  }).files
}

describe('preview browser — compiled Video and Table modules', () => {
  const timeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null
  let mediaRequests: string[] = []

  beforeEach(async () => {
    server = await createPreviewServer({ initialFiles: buildVideoAndTableFiles() })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
    mediaRequests = []
    await page.route(`${MEDIA_ORIGIN}/**`, (route) => {
      mediaRequests.push(route.request().url())
      return route.abort('blockedbyclient')
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
    'renders native video properties and semantic escaped table cells',
    async () => {
      if (!server || !page) throw new Error('Missing Video/Table preview runtime')
      await page.goto(server.url, { waitUntil: 'domcontentloaded' })

      const video = page.locator('[data-openpencil-video] video')
      await video.waitFor({ state: 'visible' })
      expect(await video.getAttribute('src')).toBe(`${MEDIA_ORIGIN}/demo.mp4`)
      expect(await video.getAttribute('poster')).toBe(`${MEDIA_ORIGIN}/poster.webp`)
      expect(await video.getAttribute('preload')).toBe('auto')
      expect(await video.getAttribute('playsinline')).not.toBeNull()
      expect(await video.evaluate((element) => (element as HTMLVideoElement).controls)).toBe(true)
      expect(await video.evaluate((element) => (element as HTMLVideoElement).autoplay)).toBe(true)
      expect(await video.evaluate((element) => (element as HTMLVideoElement).muted)).toBe(true)
      expect(await video.evaluate((element) => (element as HTMLVideoElement).loop)).toBe(true)
      expect(await video.evaluate((element) => getComputedStyle(element).objectFit)).toBe('cover')
      expect(await page.getByText('Video overlay').count()).toBe(1)
      expect(await page.locator('[data-openpencil-video] iframe').count()).toBe(0)

      const table = page.locator('[data-openpencil-table] table')
      await table.waitFor({ state: 'visible' })
      expect(await table.locator('thead').count()).toBe(1)
      expect(await table.locator('th[scope="col"]').allTextContents()).toEqual(['Name', 'Status'])
      expect(await table.locator('tbody tr').count()).toBe(2)
      expect(await table.locator('tbody td').allTextContents()).toContain(
        '<img src=x onerror="window.parent.__openPencilTableExecuted=true">'
      )
      expect(await table.locator('img, script').count()).toBe(0)
      expect(await page.evaluate(() => Boolean(window.__openPencilTableExecuted))).toBe(false)
      const rows = table.locator('tbody tr')
      expect(
        await rows.nth(0).evaluate((element) => getComputedStyle(element).backgroundColor)
      ).toBe('rgba(0, 0, 0, 0)')
      expect(
        await rows.nth(1).evaluate((element) => getComputedStyle(element).backgroundColor)
      ).toBe('rgb(249, 250, 251)')
      const firstCellStyle = await table
        .locator('tbody td')
        .first()
        .evaluate((element) => {
          const cell = element as HTMLElement
          const computed = getComputedStyle(cell)
          return {
            height: cell.style.height,
            lineHeight: cell.style.lineHeight,
            paddingBottom: computed.paddingBottom,
            paddingLeft: computed.paddingLeft,
            paddingRight: computed.paddingRight,
            paddingTop: computed.paddingTop
          }
        })
      expect(firstCellStyle).toEqual({
        height: 'max(22px, 1.4em)',
        lineHeight: '1.4',
        paddingBottom: '0px',
        paddingLeft: '10.5px',
        paddingRight: '10.5px',
        paddingTop: '0px'
      })
      const scroll = page.locator('[data-openpencil-table-scroll]')
      expect(await scroll.evaluate((element) => getComputedStyle(element).overflow)).toBe('auto')
      expect(await scroll.getAttribute('tabindex')).toBe('0')
      expect(await page.getByText('Table overlay').count()).toBe(1)
    },
    timeoutMs
  )

  test(
    'does not activate preview video networking until the user clicks the load control',
    async () => {
      if (!server || !page) throw new Error('Missing Video/Table preview runtime')
      server.updateFiles(buildVideoAndTableFiles(true))
      await page.goto(server.url, { waitUntil: 'domcontentloaded' })

      const video = page.locator('[data-openpencil-video] video')
      const loadButton = page.getByRole('button', { name: 'Load video preview' })
      await video.waitFor({ state: 'visible' })
      await loadButton.waitFor({ state: 'visible' })

      expect(await video.getAttribute('src')).toBeNull()
      expect(await video.getAttribute('poster')).toBeNull()
      expect(await video.getAttribute('preload')).toBe('none')
      expect(await video.evaluate((element) => (element as HTMLVideoElement).autoplay)).toBe(false)
      expect(mediaRequests).toEqual([])

      const firstMediaRequest = page.waitForRequest((request) =>
        request.url().startsWith(`${MEDIA_ORIGIN}/`)
      )
      await loadButton.click()
      await firstMediaRequest

      expect(await video.getAttribute('src')).toBe(`${MEDIA_ORIGIN}/demo.mp4`)
      expect(await video.getAttribute('poster')).toBe(`${MEDIA_ORIGIN}/poster.webp`)
      expect(await video.getAttribute('preload')).toBe('auto')
      expect(await video.evaluate((element) => (element as HTMLVideoElement).autoplay)).toBe(true)
      expect(await loadButton.count()).toBe(0)
      expect(mediaRequests.length).toBeGreaterThan(0)
    },
    timeoutMs
  )
})
