import { expect, mock, spyOn, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { BUILTIN_MODULE_CANVAS_ADAPTERS } from '#core/canvas/modules'
import { renderVRTourModulePreview, vrTourPreviewLabel } from '#core/canvas/modules/vr-tour'
import {
  VR_TOUR_MODULE_DEFAULT_CONFIG,
  createLocalizedVRTourConfig,
  createVRTourModuleFrameOverrides,
  createVRTourSampleScenes
} from '#core/plugins/vr-tour'

import { createMockCanvas, createMockRenderer } from './effects/helpers'

function frame(overrides: Partial<SceneNode> = {}) {
  return createDefaultNode(() => 'tour-1', 'FRAME', {
    ...createVRTourModuleFrameOverrides(),
    ...overrides
  })
}

function rendererWithFont() {
  let size = 11
  const font = {
    getGlyphIDs: (value: string) => Array.from(value, (_, index) => index),
    getGlyphWidths: (glyphs: number[]) => glyphs.map(() => 6),
    getSize: mock(() => size),
    setSize: mock((value: number) => {
      size = value
    })
  }
  const paragraphs: Array<{
    text: string
    getAlphabeticBaseline: () => number
    delete: ReturnType<typeof mock>
  }> = []
  return {
    renderer: createMockRenderer({
      labelFont: font as never,
      fontProvider: {} as never,
      fontsLoaded: true,
      nodeFontReadiness: mock(() => 'ready' as const),
      buildParagraph: mock((node: SceneNode) => {
        const paragraph = {
          text: node.text,
          getAlphabeticBaseline: () => 12,
          delete: mock(() => undefined)
        }
        paragraphs.push(paragraph)
        return paragraph as never
      })
    }),
    font,
    paragraphs
  }
}

test('VR tour uses the registered offline diagram and does not fetch configured images', () => {
  expect(vrTourPreviewLabel(VR_TOUR_MODULE_DEFAULT_CONFIG)).toBe('Living room · 360° · 2 rooms')
  expect(BUILTIN_MODULE_CANVAS_ADAPTERS.get('open-pencil.vr-tour', 'vr-tour')).toBeDefined()
  const source = structuredClone(VR_TOUR_MODULE_DEFAULT_CONFIG)
  source.scenes[0].panoramaUrl = 'https://media.example.com/panorama.jpg'
  const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
  const { renderer, font, paragraphs } = rendererWithFont()
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('Canvas must stay offline')
  })
  try {
    expect(
      renderVRTourModulePreview(
        renderer,
        canvas as Canvas,
        frame(createVRTourModuleFrameOverrides(source))
      )
    ).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    fetch.mockRestore()
  }
  const labels = paragraphs.map((paragraph) => paragraph.text)
  expect(labels).toContain('Living room · 360° · 2 rooms')
  expect(labels).toContain('Offline diagram · Preview to explore')
  expect(labels).toContain('Bedroom')
  expect(canvas.drawCircle).toHaveBeenCalledTimes(2)
  expect(canvas.save).toHaveBeenCalledTimes(1)
  expect(canvas.restore).toHaveBeenCalledTimes(1)
  expect(font.getSize()).toBe(11)
  expect(canvas.drawText).not.toHaveBeenCalled()
  for (const paragraph of paragraphs) expect(paragraph.delete).toHaveBeenCalledTimes(1)
})

test('Chinese canvas copy keeps authored labels and sample imagery offline', () => {
  const config = createLocalizedVRTourConfig('zh-CN')
  expect(vrTourPreviewLabel(config)).toBe('客厅 · 360° · 2 个场景')
  config.scenes = createVRTourSampleScenes('zh-CN')
  config.scenes[0].title = '用户命名的住宅'
  const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
  const { renderer, font, paragraphs } = rendererWithFont()
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('Sample configuration must not request panorama images')
  })
  try {
    expect(
      renderVRTourModulePreview(
        renderer,
        canvas as Canvas,
        frame(createVRTourModuleFrameOverrides(config))
      )
    ).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    fetch.mockRestore()
  }
  const labels = paragraphs.map((paragraph) => paragraph.text)
  expect(labels).toContain('用户命名的住宅 · 360° · 2 个场景')
  expect(labels).toContain('离线示意图 · 在预览中探索')
  expect(labels).toContain('切换示例 B')
  expect(labels).toContain('用户命名的住宅 / 住宅示例 B')
  expect(labels).not.toContain('Offline diagram · Preview to explore')
  expect(canvas.save).toHaveBeenCalledTimes(1)
  expect(canvas.restore).toHaveBeenCalledTimes(1)
  expect(font.getSize()).toBe(11)
  expect(canvas.drawText).not.toHaveBeenCalled()
})

test('VR tour empty, invalid, fontless and failed draws preserve canvas/font lifetimes', () => {
  const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
  const { renderer, font, paragraphs } = rendererWithFont()
  expect(renderVRTourModulePreview(renderer, canvas as Canvas, frame({ width: 0 }))).toBe(true)
  expect(renderVRTourModulePreview(renderer, canvas as Canvas, frame({ type: 'RECTANGLE' }))).toBe(
    false
  )
  expect(
    renderVRTourModulePreview(
      renderer,
      canvas as Canvas,
      frame({ interactiveProps: { module: {} } })
    )
  ).toBe(false)
  expect(canvas.save).not.toHaveBeenCalled()
  expect(
    renderVRTourModulePreview(createMockRenderer({ labelFont: null }), canvas as Canvas, frame())
  ).toBe(true)
  expect(canvas.restore).toHaveBeenCalledTimes(1)
  const broken = {
    ...createMockCanvas(),
    drawParagraph: mock(() => {
      throw new Error('paint failed')
    })
  }
  expect(() => renderVRTourModulePreview(renderer, broken as Canvas, frame())).toThrow(
    'paint failed'
  )
  expect(broken.restore).toHaveBeenCalledTimes(1)
  expect(font.getSize()).toBe(11)
  expect(paragraphs).toHaveLength(1)
  expect(paragraphs[0].delete).toHaveBeenCalledTimes(1)
})

test('VR labels wait for the shared font demand and do not paint missing-glyph boxes', () => {
  const { renderer, paragraphs } = rendererWithFont()
  renderer.nodeFontReadiness = mock(() => 'pending')
  const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
  expect(
    renderVRTourModulePreview(
      renderer,
      canvas as Canvas,
      frame(createVRTourModuleFrameOverrides(createLocalizedVRTourConfig('zh-CN')))
    )
  ).toBe(true)
  expect(paragraphs).toEqual([])
  expect(canvas.drawParagraph).not.toHaveBeenCalled()
  expect(canvas.drawText).not.toHaveBeenCalled()
  expect(canvas.restore).toHaveBeenCalledTimes(1)
})
