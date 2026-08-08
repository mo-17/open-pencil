import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import {
  BUILTIN_MODULE_CANVAS_ADAPTERS,
  renderSlideMenuModulePreview,
  slideMenuPreviewMeta
} from '#core/canvas/modules'
import { renderShapeUncached } from '#core/canvas/scene'
import {
  SLIDE_MENU_MODULE_TYPE,
  SLIDE_MENU_PLUGIN_ID,
  createSlideMenuModuleFrameOverrides,
  createSlideMenuModuleInstance,
  type SlideMenuModuleConfigV1
} from '#core/plugins/slide-menu'

import { createMockCanvas, createMockRenderer } from './effects/helpers'

const CONFIG: SlideMenuModuleConfigV1 = {
  presentation: 'dialog',
  direction: 'right',
  triggerLabel: 'Open navigation',
  title: 'Navigation',
  description: 'Choose a destination.',
  items: [{ label: 'Remote docs', href: 'https://docs.example.com/start' }],
  closeOnBackdrop: true,
  showCloseButton: true,
  panelSize: 360,
  panelBackground: '#FFFFFF',
  textColor: '#111827',
  overlayOpacity: 0.45
}

function slideMenuFrame(overrides: Partial<SceneNode> = {}): SceneNode {
  return createDefaultNode(() => 'slide-menu-1', 'FRAME', {
    ...createSlideMenuModuleFrameOverrides(CONFIG),
    ...overrides
  })
}

function rendererWithFont() {
  const labelFont = {
    getGlyphIDs: (value: string) => Array.from(value, (_, index) => index),
    getGlyphWidths: (glyphs: number[]) => glyphs.map(() => 6)
  }
  return createMockRenderer({ zoom: 1, labelFont: labelFont as never })
}

describe('slide menu module canvas preview', () => {
  test('builds a deterministic type and direction label', () => {
    for (const presentation of ['menu', 'dialog'] as const) {
      for (const direction of ['left', 'right', 'top', 'bottom'] as const) {
        expect(slideMenuPreviewMeta({ ...CONFIG, presentation, direction })).toBe(
          `${presentation} · ${direction}`
        )
      }
    }
  })

  test('draws an offline button summary without requesting item hrefs', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.reject(new Error('Canvas preview must stay offline')))
    globalThis.fetch = fetchMock as typeof fetch
    try {
      expect(renderSlideMenuModulePreview(renderer, canvas as Canvas, slideMenuFrame())).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawText.mock.calls.map((call) => call[0])).toEqual([
      'Open navigation',
      'dialog · right'
    ])
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('keeps small, fontless, and empty frames inert and balanced', () => {
    const renderer = rendererWithFont()
    const smallCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderSlideMenuModulePreview(renderer, smallCanvas as Canvas, slideMenuFrame({ height: 32 }))
    ).toBe(true)
    expect(smallCanvas.drawText.mock.calls.map((call) => call[0])).toEqual(['Open navigation'])
    expect(smallCanvas.restore).toHaveBeenCalledTimes(1)

    const fontlessCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderSlideMenuModulePreview(
        createMockRenderer({ zoom: 1, labelFont: null }),
        fontlessCanvas as Canvas,
        slideMenuFrame()
      )
    ).toBe(true)
    expect(fontlessCanvas.drawText).not.toHaveBeenCalled()
    expect(fontlessCanvas.restore).toHaveBeenCalledTimes(1)

    const emptyCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderSlideMenuModulePreview(renderer, emptyCanvas as Canvas, slideMenuFrame({ width: 0 }))
    ).toBe(true)
    expect(emptyCanvas.save).not.toHaveBeenCalled()
    expect(emptyCanvas.drawRect).not.toHaveBeenCalled()
  })

  test('restores the Canvas save stack when label drawing fails', () => {
    const canvas = {
      ...createMockCanvas(),
      drawText: mock(() => {
        throw new Error('draw failed')
      })
    }
    expect(() =>
      renderSlideMenuModulePreview(rendererWithFont(), canvas as Canvas, slideMenuFrame())
    ).toThrow('draw failed')
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('registers and dispatches regular FRAME rendering while invalid identities fail closed', () => {
    expect(
      BUILTIN_MODULE_CANVAS_ADAPTERS.get(SLIDE_MENU_PLUGIN_ID, SLIDE_MENU_MODULE_TYPE)
    ).toBeDefined()
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()
    renderShapeUncached(renderer, canvas as Canvas, slideMenuFrame(), new SceneGraph())
    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(canvas.drawText.mock.calls.map((call) => call[0])).toEqual([
      'Open navigation',
      'dialog · right'
    ])

    const invalid = slideMenuFrame({
      interactiveProps: {
        module: { ...createSlideMenuModuleInstance(), pluginId: 'unknown.plugin' }
      }
    })
    const invalidCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(renderSlideMenuModulePreview(renderer, invalidCanvas as Canvas, invalid)).toBe(false)
    expect(invalidCanvas.drawRect).not.toHaveBeenCalled()
    expect(invalidCanvas.drawText).not.toHaveBeenCalled()

    const invalidVersion = slideMenuFrame({
      interactiveProps: {
        module: { ...createSlideMenuModuleInstance(), configVersion: 2 }
      }
    })
    expect(renderSlideMenuModulePreview(renderer, invalidCanvas as Canvas, invalidVersion)).toBe(
      false
    )
  })
})
