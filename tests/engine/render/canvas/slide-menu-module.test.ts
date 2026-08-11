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
  type SlideMenuModuleConfig
} from '#core/plugins/slide-menu'

import { createMockCanvas, createMockRenderer } from './effects/helpers'

const CONFIG: SlideMenuModuleConfig = {
  presentation: 'dialog',
  direction: 'right',
  triggerLabel: 'Open navigation',
  showTriggerIcon: true,
  showTriggerLabel: true,
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

function slideMenuFrame(
  overrides: Partial<SceneNode> = {},
  config: SlideMenuModuleConfig = CONFIG
): SceneNode {
  return createDefaultNode(() => 'slide-menu-1', 'FRAME', {
    ...createSlideMenuModuleFrameOverrides(config),
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
    expect(canvas.drawRect).toHaveBeenCalledTimes(4)
    expect(canvas.drawRect.mock.calls.slice(1).map((call) => Array.from(call[0]))).toEqual([
      [32, 17, 50, 19],
      [32, 23, 50, 25],
      [32, 29, 50, 31]
    ])
    expect(canvas.drawText.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['Open navigation', 58, 28]
    ])
    expect(renderer.color4f.mock.calls[0]).toEqual([38 / 255, 99 / 255, 235 / 255, 1])
    expect(renderer.color4f).toHaveBeenLastCalledWith(1, 1, 1, 1)
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('renders every independent trigger icon and label visibility combination', () => {
    const cases = [
      {
        name: 'icon and label',
        showTriggerIcon: true,
        showTriggerLabel: true,
        expectedBars: [
          [32, 17, 50, 19],
          [32, 23, 50, 25],
          [32, 29, 50, 31]
        ],
        expectedText: [['Open navigation', 58, 28]],
        expectedColorCalls: 2
      },
      {
        name: 'icon only',
        showTriggerIcon: true,
        showTriggerLabel: false,
        expectedBars: [
          [81, 17, 99, 19],
          [81, 23, 99, 25],
          [81, 29, 99, 31]
        ],
        expectedText: [],
        expectedColorCalls: 2
      },
      {
        name: 'label only',
        showTriggerIcon: false,
        showTriggerLabel: true,
        expectedBars: [],
        expectedText: [['Open navigation', 45, 28]],
        expectedColorCalls: 2
      },
      {
        name: 'background only',
        showTriggerIcon: false,
        showTriggerLabel: false,
        expectedBars: [],
        expectedText: [],
        expectedColorCalls: 1
      }
    ] as const

    for (const visibility of cases) {
      const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
      const renderer = rendererWithFont()
      expect(
        renderSlideMenuModulePreview(
          renderer,
          canvas as Canvas,
          slideMenuFrame(
            {},
            {
              ...CONFIG,
              showTriggerIcon: visibility.showTriggerIcon,
              showTriggerLabel: visibility.showTriggerLabel
            }
          )
        ),
        visibility.name
      ).toBe(true)
      expect(
        canvas.drawRect.mock.calls.slice(1).map((call) => Array.from(call[0])),
        visibility.name
      ).toEqual(visibility.expectedBars)
      expect(
        canvas.drawText.mock.calls.map((call) => call.slice(0, 3)),
        visibility.name
      ).toEqual(visibility.expectedText)
      expect(renderer.color4f, visibility.name).toHaveBeenCalledTimes(visibility.expectedColorCalls)
    }
  })

  test('lets authored children replace the intrinsic trigger preview', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderSlideMenuModulePreview(
        rendererWithFont(),
        canvas as Canvas,
        slideMenuFrame({ childIds: ['authored-trigger-label'] })
      )
    ).toBe(true)
    expect(canvas.save).not.toHaveBeenCalled()
    expect(canvas.drawRect).not.toHaveBeenCalled()
    expect(canvas.drawText).not.toHaveBeenCalled()
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
    expect(fontlessCanvas.drawRect).toHaveBeenCalledTimes(4)
    expect(fontlessCanvas.restore).toHaveBeenCalledTimes(1)

    const tinyCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderSlideMenuModulePreview(
        renderer,
        tinyCanvas as Canvas,
        slideMenuFrame({ width: 20, height: 10 })
      )
    ).toBe(true)
    expect(tinyCanvas.drawRect).toHaveBeenCalledTimes(1)
    expect(tinyCanvas.drawText).not.toHaveBeenCalled()
    expect(tinyCanvas.restore).toHaveBeenCalledTimes(1)

    const emptyCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderSlideMenuModulePreview(renderer, emptyCanvas as Canvas, slideMenuFrame({ width: 0 }))
    ).toBe(true)
    expect(emptyCanvas.save).not.toHaveBeenCalled()
    expect(emptyCanvas.drawRect).not.toHaveBeenCalled()
  })

  test('ellipsizes a long trigger label without moving the centered icon-label group', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()
    const triggerLabel = 'Open the complete navigation menu for this workspace'
    expect(
      renderSlideMenuModulePreview(
        renderer,
        canvas as Canvas,
        slideMenuFrame({}, { ...CONFIG, triggerLabel })
      )
    ).toBe(true)

    const [text, x, y] = canvas.drawText.mock.calls[0]
    expect(text).not.toBe(triggerLabel)
    expect(text).toEndWith('…')
    expect(y).toBe(28)
    const textWidth = String(text).length * 6
    expect(x).toBe((180 - (18 + 8 + textWidth)) / 2 + 26)
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
    expect(canvas.drawText.mock.calls.map((call) => call[0])).toEqual(['Open navigation'])

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
        module: { ...createSlideMenuModuleInstance(), configVersion: 3 }
      }
    })
    expect(renderSlideMenuModulePreview(renderer, invalidCanvas as Canvas, invalidVersion)).toBe(
      false
    )
  })
})
