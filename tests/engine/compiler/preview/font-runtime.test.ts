import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function buildFontFiles(): Map<string, string | Uint8Array> {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.createNode('TEXT', pageId, {
    text: 'Compiler font identity',
    fontFamily: 'Inter',
    fontSize: 40,
    fontWeight: 400,
    lineHeight: 48,
    width: 400,
    height: 48
  })
  const content = new Uint8Array(readFileSync(join(process.cwd(), 'public/Inter-Regular.ttf')))
  return compile({
    graph,
    pageIds: [pageId],
    fontManifest: {
      faces: [
        {
          family: 'Inter',
          weight: 400,
          style: 'normal',
          format: 'truetype',
          path: 'src/assets/fonts/inter-400-normal.ttf',
          content
        }
      ]
    },
    options: withDefaults({ packageName: 'font-runtime' })
  }).files
}

describe('preview browser — compiler font assets', () => {
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({ initialFiles: buildFontFiles() })
    browser = await chromium.launch()
    page = await browser.newPage()
  })

  afterEach(async () => {
    await page?.close()
    await browser?.close()
    if (server) await server.close()
    page = null
    browser = null
    server = null
  })

  test('loads the emitted face inside the isolated preview document', async () => {
    if (!server || !page) throw new Error('preview runtime was not initialized')
    await page.goto(server.url)
    await page.evaluate(() => document.fonts.ready)

    const state = await page.evaluate(() => {
      const paragraph = document.querySelector('p')
      return {
        family: paragraph ? getComputedStyle(paragraph).fontFamily : '',
        fontSize: paragraph ? getComputedStyle(paragraph).fontSize : '',
        lineHeight: paragraph ? getComputedStyle(paragraph).lineHeight : '',
        faces: [...document.fonts].map((face) => ({ family: face.family, status: face.status }))
      }
    })
    expect(state.family).toContain('Inter')
    expect(state.fontSize).toBe('40px')
    expect(state.lineHeight).toBe('48px')
    expect(state.faces).toContainEqual({ family: 'Inter', status: 'loaded' })

    const response = await fetch(`${server.url}assets/fonts/inter-400-normal.ttf`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('font/ttf')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(10_000)
  }, 20_000)
})
