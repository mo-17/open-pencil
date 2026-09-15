import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { compile, withDefaults } from '@open-pencil/compiler'
import { BROWSER_PREVIEW_LIMITS, buildBrowserPreview } from '@open-pencil/compiler/browser-preview'
import {
  VR_TOUR_SAMPLE_ASSETS,
  createLocalizedVRTourConfig,
  createVRTourModuleInstance,
  createVRTourSampleScenes
} from '@open-pencil/core/plugins'

import {
  compileDiagnosticMessage,
  compileErrorMessage,
  summarizeStructuredCompileDiagnostics
} from '@/app/lowcode/preview-pane/compile-diagnostics'

import { browserPreviewInput } from '#tests/engine/compiler/browser-preview/helpers'
import { compileTour, tourFixture } from '#tests/engine/compiler/vr-tour/helpers'

const code = 'browser-preview-vr-tour-runtime-unsupported'
const english =
  'VR tours require desktop preview or an exported React/Vue app. Browser preview blocks panorama networking and package CSS.'
const chinese =
  'VR 全景需要在桌面端预览，或导出为 React/Vue 应用后使用。浏览器预览暂不支持全景图片加载和所需样式。'
const diagnostic = Object.freeze({ code, severity: 'error' as const, message: english })
const fileSizeChinese =
  '浏览器预览不支持超出大小限制或格式无效的生成文件。请检查该文件；较大的素材可使用桌面端预览，或导出 React/Vue 应用后使用。'

test('persisted 8K samples retain the browser size limit and display actionable Chinese copy', async () => {
  const { graph, pageId, node } = tourFixture()
  const config = createLocalizedVRTourConfig('zh-CN')
  config.scenes = createVRTourSampleScenes('zh-CN')
  graph.updateNode(node.id, { interactiveProps: { module: createVRTourModuleInstance(config) } })
  for (const sample of VR_TOUR_SAMPLE_ASSETS) {
    const bytes = new Uint8Array(
      readFileSync(
        new URL(`../../../../../packages/demos/vr-tour/${sample.fileName}`, import.meta.url)
      )
    )
    graph.images.set(sample.graphImageHash, bytes)
  }
  const output = compile({ graph, pageIds: [pageId], options: withDefaults({ devMode: true }) })
  const sample = VR_TOUR_SAMPLE_ASSETS[0]
  const image = output.files.get('public' + sample.panoramaUrl)
  expect(image).toBeInstanceOf(Uint8Array)
  expect((image as Uint8Array).byteLength).toBeGreaterThan(
    BROWSER_PREVIEW_LIMITS.maxBinaryFileBytes
  )
  const input = await browserPreviewInput(output.files)
  const stages: string[] = []
  input.onStage = (stage) => stages.push(stage)
  const result = await buildBrowserPreview(input)
  const original = {
    code: 'browser-preview-file-size-limit',
    severity: 'error' as const,
    message: 'Browser preview blocked an oversized or invalid generated file.',
    path: 'public' + sample.panoramaUrl
  }
  expect(result.status).toBe('error')
  expect(result.metrics.outputBytes).toBe(0)
  expect(stages).toEqual(['bundle-validate'])
  expect(result.diagnostics).toEqual([original])
  expect(summarizeStructuredCompileDiagnostics(result.diagnostics, 'zh-CN').items).toEqual([
    { ...original, message: fileSizeChinese }
  ])
  expect(compileErrorMessage(original.message, result.diagnostics, 'zh-CN')).toBe(fileSizeChinese)
  expect(compileDiagnosticMessage(original)).toBe(original.message)
  expect(result.diagnostics).toEqual([original])
})

test('the real browser VR rejection displays in Chinese without changing its compiler policy', async () => {
  const result = await buildBrowserPreview(
    await browserPreviewInput(compileTour('react', undefined, true).files)
  )
  expect(result.status).toBe('error')
  expect(result.metrics.outputBytes).toBe(0)
  expect(result.diagnostics).toContainEqual(diagnostic)
  const summary = summarizeStructuredCompileDiagnostics(result.diagnostics, 'zh-CN')
  expect(summary).toMatchObject({ errorCount: 1, warningCount: 0, total: 1 })
  expect(summary.items[0]).toEqual({ ...diagnostic, message: chinese })
  expect(compileErrorMessage(english, result.diagnostics, 'zh-CN')).toBe(chinese)
  expect(result.diagnostics).toContainEqual(diagnostic)
})

test('English and unspecified editor locales preserve the original VR diagnostic', () => {
  expect(compileDiagnosticMessage(diagnostic)).toBe(english)
  expect(compileDiagnosticMessage(diagnostic, 'en')).toBe(english)
  expect(compileDiagnosticMessage(diagnostic, 'fr')).toBe(english)
  expect(compileErrorMessage(english, [diagnostic])).toBe(english)
  expect(summarizeStructuredCompileDiagnostics([diagnostic]).items[0]).toEqual(diagnostic)
})

test('only the exact error code is translated and stale VR diagnostics do not replace another error', () => {
  const other = { ...diagnostic, code: 'browser-preview-another-error', path: 'src/App.tsx' }
  expect(compileDiagnosticMessage(other, 'zh-CN')).toBe(english)
  expect(compileErrorMessage('Another compile failure', [diagnostic], 'zh-CN')).toBe(
    'Another compile failure'
  )
  expect(compileErrorMessage(english, [{ ...diagnostic, severity: 'warning' }], 'zh-CN')).toBe(
    english
  )
  const located = { ...diagnostic, path: 'src/App.tsx', line: 4, column: 2, nodeId: 'tour-node' }
  expect(summarizeStructuredCompileDiagnostics([located], 'zh-CN').items[0]).toEqual({
    ...located,
    message: chinese
  })
})
