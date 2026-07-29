import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import { sampleGeneratedEffect } from '@open-pencil/core/motion'

import { generatedEffect } from '#tests/helpers/generated-effect'
import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

interface GeneratedEffectRuntime {
  renderAt(timeMs: number): void
  refresh(): void
  dispose(): void
  inspect(): { activeLayerCount: number; nodeIds: string[] }
  sample(raw: string, timeMs: number, reduced?: boolean, supported?: boolean): unknown
}

declare global {
  interface Window {
    __OPENPENCIL_GENERATED_EFFECT_RUNTIME__?: GeneratedEffectRuntime
  }
}

describe('preview browser — generated-effect Canvas2D fallback', () => {
  const timeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 })
  }, timeoutMs)

  afterEach(async () => {
    try {
      if (page) await page.close()
    } finally {
      try {
        if (browser) await browser.close()
      } finally {
        if (server) await server.close()
        page = null
        browser = null
        server = null
      }
    }
  }, timeoutMs)

  test(
    'matches the core sampler, caps pixels, honors reduced/fallback, and cleans up',
    async () => {
      if (!server || !page) throw new Error('Missing browser fixture')
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      const spec = generatedEffect('particles')
      spec.budget.maxRasterPixels = 4_096
      const node = graph.createNode('RECTANGLE', pageId, {
        name: 'Browser generated layer',
        width: 800,
        height: 600,
        generatedEffect: spec
      })
      const files = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ packageName: 'generated-effect-browser', devMode: false })
      }).files
      server.updateFiles(files)
      await page.goto(server.url, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => '__OPENPENCIL_GENERATED_EFFECT_RUNTIME__' in window)
      await page.waitForFunction(() =>
        Boolean(document.querySelector('[data-op-generated-effect-layer]'))
      )

      const browserSample = await page.evaluate(
        ({ nodeId, timeMs }) => {
          const host = document.querySelector<HTMLElement>(
            `[data-op-generated-effect-node="${nodeId}"]`
          )
          const raw = host?.dataset.opGeneratedEffect
          const runtime = window.__OPENPENCIL_GENERATED_EFFECT_RUNTIME__
          if (!raw || !runtime) throw new Error('Missing generated layer runtime')
          return runtime.sample(raw, timeMs)
        },
        { nodeId: node.id, timeMs: 750 }
      )
      expect(browserSample).toEqual(sampleGeneratedEffect(spec, 750))

      const reducedSamples = await page.evaluate((nodeId) => {
        const host = document.querySelector<HTMLElement>(
          `[data-op-generated-effect-node="${nodeId}"]`
        )
        const raw = host?.dataset.opGeneratedEffect
        const runtime = window.__OPENPENCIL_GENERATED_EFFECT_RUNTIME__
        if (!raw || !runtime) throw new Error('Missing generated layer runtime')
        return [runtime.sample(raw, 0, true), runtime.sample(raw, 9_000, true)]
      }, node.id)
      expect(reducedSamples[0]).toEqual(
        sampleGeneratedEffect(spec, 0, { prefersReducedMotion: true })
      )
      expect(reducedSamples[1]).toEqual(reducedSamples[0])

      const inspection = await page.evaluate((nodeId) => {
        const host = document.querySelector<HTMLElement>(
          `[data-op-generated-effect-node="${nodeId}"]`
        )
        const canvas = host?.querySelector<HTMLCanvasElement>('[data-op-generated-effect-layer]')
        const runtime = window.__OPENPENCIL_GENERATED_EFFECT_RUNTIME__
        if (!host || !canvas || !runtime) throw new Error('Missing generated layer')
        return {
          backingPixels: canvas.width * canvas.height,
          inspect: runtime.inspect(),
          malformed: runtime.sample(
            JSON.stringify({
              ...JSON.parse(host.dataset.opGeneratedEffect ?? '{}'),
              shader: 'main() {}'
            }),
            0
          )
        }
      }, node.id)
      expect(inspection.backingPixels).toBeLessThanOrEqual(spec.budget.maxRasterPixels)
      expect(inspection.inspect).toEqual({ activeLayerCount: 1, nodeIds: [node.id] })
      expect(inspection.malformed).toBeNull()

      const cleanup = await page.evaluate((nodeId) => {
        const host = document.querySelector<HTMLElement>(
          `[data-op-generated-effect-node="${nodeId}"]`
        )
        const runtime = window.__OPENPENCIL_GENERATED_EFFECT_RUNTIME__
        if (!host || !runtime) throw new Error('Missing generated layer')
        const raw = host.dataset.opGeneratedEffect
        host.dataset.opGeneratedEffect = JSON.stringify({ version: 2 })
        runtime.refresh()
        const invalidLayerCount = host.querySelectorAll('[data-op-generated-effect-layer]').length
        const invalidInspection = runtime.inspect()
        if (raw) host.dataset.opGeneratedEffect = raw
        runtime.refresh()
        const restoredLayerCount = host.querySelectorAll('[data-op-generated-effect-layer]').length
        runtime.dispose()
        return {
          invalidLayerCount,
          invalidInspection,
          restoredLayerCount,
          finalLayerCount: host.querySelectorAll('[data-op-generated-effect-layer]').length,
          handleRemoved: window.__OPENPENCIL_GENERATED_EFFECT_RUNTIME__ === undefined
        }
      }, node.id)
      expect(cleanup).toEqual({
        invalidLayerCount: 0,
        invalidInspection: { activeLayerCount: 0, nodeIds: [] },
        restoredLayerCount: 1,
        finalLayerCount: 0,
        handleRemoved: true
      })
    },
    timeoutMs
  )
})
