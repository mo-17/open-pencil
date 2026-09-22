import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'

import { computeNavigationMetrics } from '#tools/navigation-benchmark/src/metrics'
import { readRecording } from '#tools/navigation-benchmark/src/recording'
import { replay } from '#tools/navigation-benchmark/src/replay'
import { setupScenario, type NavigationScenario } from '#tools/navigation-benchmark/src/scenario'
import type { NavigationRecordingFile } from '#tools/navigation-benchmark/src/types'

import type { FontManager } from '@open-pencil/core/text'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'

const scenarios: NavigationScenario[] = [
  'light',
  'large-flat',
  'image-heavy',
  'complex-text',
  'mixed-fonts'
]

for (const scenario of scenarios) {
  test(`fixed ${scenario} scene preserves edited FIG export and records local performance`, async ({
    page,
    browser
  }) => {
    test.setTimeout(180_000)
    await trackFontModuleResources(page)
    await mockFontsource(page, [])
    const started = performance.now()
    await page.goto('/?test&no-chrome&no-rulers&navigation-benchmark')
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    const bootstrapMs = performance.now() - started
    if (scenario === 'mixed-fonts') {
      await page.evaluate(async () => {
        const moduleURL = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .find((url) => url.includes('/packages/core/src/text/fonts.ts'))
        if (!moduleURL) throw new Error('Font manager module unavailable in development fixture')
        const { fontManager } = (await import(/* @vite-ignore */ moduleURL)) as {
          fontManager: FontManager
        }
        const response = await fetch('/tests/fixtures/fonts/NotoSansCJK-Test.otf')
        if (!response.ok) throw new Error('Licensed CJK font fixture unavailable')
        fontManager.markLoaded('Noto Sans CJK SC', 'Regular', await response.arrayBuffer())
        fontManager.setCJKFallbackFamily('Noto Sans CJK SC')
      })
    }
    const setupStarted = performance.now()
    await setupScenario(page, scenario)
    await page.evaluate(() => window.openPencil?.test?.navigation?.waitForSettlement())
    const setupMs = performance.now() - setupStarted
    const input = await readRecording(
      'tests/fixtures/navigation/gestures/synthetic-pinch-reversal.json'
    )
    await page.evaluate(() =>
      window.openPencil?.test?.navigation?.startRecording('stability-roundtrip')
    )
    await replay(page, input, 'dom')
    await page.evaluate(() => window.openPencil?.test?.navigation?.waitForSettlement())
    const recording = await page.evaluate(
      () => window.openPencil?.test?.navigation?.stopRecording() as NavigationRecordingFile
    )
    const metrics = computeNavigationMetrics(recording)
    expect(metrics.renderCount).toBeGreaterThan(0)

    const fixture = await page.evaluateHandle(async () => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('Store unavailable')
      const buildStarted = performance.now()
      const initial = await store.buildFigFileSnapshot()
      const firstSerializeMs = performance.now() - buildStarted
      const importStarted = performance.now()
      await store.openFigFile(new File([new Uint8Array(initial.data)], 'stability.fig'))
      const importMs = performance.now() - importStarted
      const children = store.graph.getChildren(store.state.currentPageId)
      const target = children[0]
      if (!target) throw new Error('Imported scene is empty')
      store.updateNode(target.id, { name: 'Edited roundtrip target', opacity: 0.75 })
      const recoveryStarted = performance.now()
      await store.persistRecoveryNow()
      const recoveryMs = performance.now() - recoveryStarted
      const sampleIds = children.slice(0, 9).map((node) => node.id)
      await store.loadFontsForNodes(sampleIds)
      const exportStarted = performance.now()
      const before = await store.renderExportImage(sampleIds, 1, 'PNG')
      if (!before) throw new Error('PNG export failed')
      const pngExportMs = performance.now() - exportStarted
      const saveStarted = performance.now()
      const saved = await store.buildFigFileSnapshot()
      const serializeMs = performance.now() - saveStarted
      const shape = children.map((node) => ({
        name: node.name,
        type: node.type,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        text: node.text,
        opacity: node.opacity
      }))
      return {
        before,
        saved,
        shape,
        importMs,
        firstSerializeMs,
        serializeMs,
        pngExportMs,
        recoveryMs
      }
    })
    const result = await fixture.evaluate(async (fixture) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('Store unavailable')
      const started = performance.now()
      await store.openFigFile(
        new File([new Uint8Array(fixture.saved.data)], 'edited-stability.fig')
      )
      const reimportMs = performance.now() - started
      const children = store.graph.getChildren(store.state.currentPageId)
      const sampleIds = children.slice(0, 9).map((node) => node.id)
      await store.loadFontsForNodes(sampleIds)
      const after = await store.renderExportImage(sampleIds, 1, 'PNG')
      if (!after) throw new Error('Roundtrip PNG export failed')
      const shape = children.map((node) => ({
        name: node.name,
        type: node.type,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        text: node.text,
        opacity: node.opacity
      }))
      const decode = async (bytes: Uint8Array) => {
        const image = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: 'image/png' })
        )
        const surface = new OffscreenCanvas(image.width, image.height)
        const context = surface.getContext('2d')
        if (!context) throw new Error('Pixel comparison context unavailable')
        context.drawImage(image, 0, 0)
        image.close()
        return context.getImageData(0, 0, surface.width, surface.height)
      }
      const [left, right] = await Promise.all([decode(fixture.before), decode(after)])
      let changedChannels = 0
      let channelsOver16 = 0
      for (let index = 0; index < left.data.length; index++) {
        const difference = Math.abs(left.data[index] - right.data[index])
        if (difference) changedChannels++
        if (difference > 16) channelsOver16++
      }
      const gl = document.createElement('canvas').getContext('webgl2')
      const debug = gl?.getExtension('WEBGL_debug_renderer_info')
      return {
        before: Array.from(fixture.before),
        after: Array.from(after),
        structureMatches: JSON.stringify(shape) === JSON.stringify(fixture.shape),
        dimensionsMatch: left.width === right.width && left.height === right.height,
        changedChannels,
        channelsOver16,
        comparedChannels: left.data.length,
        nodeCount: children.length,
        figBytes: fixture.saved.data.length,
        bootstrap: navigator.userAgent,
        renderer: gl
          ? String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER))
          : 'unavailable',
        importMs: fixture.importMs,
        reimportMs,
        firstSerializeMs: fixture.firstSerializeMs,
        serializeMs: fixture.serializeMs,
        pngExportMs: fixture.pngExportMs,
        recoveryMs: fixture.recoveryMs,
        fonts: children
          .filter((node) => node.type === 'TEXT')
          .slice(0, 9)
          .map((node) => ({
            family: node.fontFamily,
            readiness: store.renderer?.nodeFontReadiness(node)
          }))
      }
    })
    await fixture.dispose()
    const { before, after, ...evidence } = result
    const report = {
      scenario,
      recordedAt: new Date().toISOString(),
      browser: browser.version(),
      platform: process.platform,
      arch: process.arch,
      mode: 'development / synthetic DOM input / software GPU / concurrent local work',
      bootstrapMs,
      setupMs,
      metrics,
      ...evidence
    }
    const artifacts = [
      {
        name: `${scenario}-edited-before.png`,
        body: Buffer.from(before),
        contentType: 'image/png'
      },
      {
        name: `${scenario}-export-reimport.png`,
        body: Buffer.from(after),
        contentType: 'image/png'
      },
      {
        name: `${scenario}-evidence.json`,
        body: Buffer.from(JSON.stringify(report, null, 2)),
        contentType: 'application/json'
      }
    ]
    for (const artifact of artifacts) {
      const path = test.info().outputPath(artifact.name)
      await writeFile(path, artifact.body)
      await test.info().attach(artifact.name, { path, contentType: artifact.contentType })
    }
    expect(result.structureMatches).toBe(true)
    expect(result.dimensionsMatch).toBe(true)
    expect(result.changedChannels).toBe(0)
    canvas.assertNoErrors()
  })
}
