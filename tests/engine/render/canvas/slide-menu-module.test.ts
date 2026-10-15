import { describe, expect, mock, test } from 'bun:test'

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

import {
  rectValues,
  canvasMock,
  createMockCanvas,
  createMockRenderer
} from '#tests/engine/render/canvas/effects/helpers'
import { asDouble, asCanvas } from '#tests/engine/render/canvas/helpers'

import { moduleTextRenderer, paragraphText } from './modules/helpers'

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
  return moduleTextRenderer()
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
    const canvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    const renderer = rendererWithFont()
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.reject(new Error('Canvas preview must stay offline')))
    globalThis.fetch = asDouble<typeof fetch>(fetchMock)
    try {
      expect(renderSlideMenuModulePreview(renderer, asCanvas(canvas), slideMenuFrame())).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawRect).toHaveBeenCalledTimes(4)
    expect<unknown>(canvas.drawRect.mock.calls.slice(1).map((call) => rectValues(call[0]))).toEqual(
      [
        [32, 17, 50, 19],
        [32, 23, 50, 25],
        [32, 29, 50, 31]
      ]
    )
    expect(
      canvas.drawParagraph.mock.calls.map((call) => [paragraphText(call[0]), call[1], call[2]])
    ).toEqual([['Open navigation', 58, 28]])
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
        expectedColorCalls: 3
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
        expectedColorCalls: 3
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
      const canvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
      const renderer = rendererWithFont()
      expect(
        renderSlideMenuModulePreview(
          renderer,
          asCanvas(canvas),
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
      expect<unknown>(
        canvas.drawRect.mock.calls.slice(1).map((call) => rectValues(call[0])),
        visibility.name
      ).toEqual(visibility.expectedBars)
      expect<unknown>(
        canvas.drawParagraph.mock.calls.map((call) => [paragraphText(call[0]), call[1], call[2]]),
        visibility.name
      ).toEqual(visibility.expectedText)
      expect(renderer.color4f, visibility.name).toHaveBeenCalledTimes(visibility.expectedColorCalls)
    }
  })

  test('lets authored children replace the intrinsic trigger preview', () => {
    const canvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    expect(
      renderSlideMenuModulePreview(
        rendererWithFont(),
        asCanvas(canvas),
        slideMenuFrame({ childIds: ['authored-trigger-label'] })
      )
    ).toBe(true)
    expect(canvas.save).not.toHaveBeenCalled()
    expect(canvas.drawRect).not.toHaveBeenCalled()
    expect(canvas.drawParagraph).not.toHaveBeenCalled()
  })

  test('keeps small, fontless, and empty frames inert and balanced', () => {
    const renderer = rendererWithFont()
    const smallCanvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    expect(
      renderSlideMenuModulePreview(renderer, asCanvas(smallCanvas), slideMenuFrame({ height: 32 }))
    ).toBe(true)
    expect(smallCanvas.drawParagraph.mock.calls.map((call) => paragraphText(call[0]))).toEqual([
      'Open navigation'
    ])
    expect(smallCanvas.restore).toHaveBeenCalledTimes(1)

    const fontlessCanvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    expect(
      renderSlideMenuModulePreview(
        createMockRenderer({ zoom: 1, labelFont: null }),
        asCanvas(fontlessCanvas),
        slideMenuFrame()
      )
    ).toBe(true)
    expect(fontlessCanvas.drawParagraph).not.toHaveBeenCalled()
    expect(fontlessCanvas.drawRect).toHaveBeenCalledTimes(4)
    expect(fontlessCanvas.restore).toHaveBeenCalledTimes(1)

    const tinyCanvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    expect(
      renderSlideMenuModulePreview(
        renderer,
        asCanvas(tinyCanvas),
        slideMenuFrame({ width: 20, height: 10 })
      )
    ).toBe(true)
    expect(tinyCanvas.drawRect).toHaveBeenCalledTimes(1)
    expect(tinyCanvas.drawParagraph).not.toHaveBeenCalled()
    expect(tinyCanvas.restore).toHaveBeenCalledTimes(1)

    const emptyCanvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    expect(
      renderSlideMenuModulePreview(renderer, asCanvas(emptyCanvas), slideMenuFrame({ width: 0 }))
    ).toBe(true)
    expect(emptyCanvas.save).not.toHaveBeenCalled()
    expect(emptyCanvas.drawRect).not.toHaveBeenCalled()
  })

  test('ellipsizes a long trigger label without moving the centered icon-label group', () => {
    const canvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    const renderer = rendererWithFont()
    const triggerLabel = 'Open the complete navigation menu for this workspace'
    expect(
      renderSlideMenuModulePreview(
        renderer,
        asCanvas(canvas),
        slideMenuFrame({}, { ...CONFIG, triggerLabel })
      )
    ).toBe(true)

    const [paragraph, x, y] = canvas.drawParagraph.mock.calls[0]
    const text = paragraphText(paragraph)
    expect(text).not.toBe(triggerLabel)
    expect(text).toEndWith('…')
    expect(y).toBe(28)
    const textWidth = String(text).length * 6
    expect(x).toBe((180 - (18 + 8 + textWidth)) / 2 + 26)
  })

  test('restores the Canvas save stack when label drawing fails', () => {
    const canvas = {
      ...createMockCanvas(),
      drawParagraph: mock(() => {
        throw new Error('draw failed')
      })
    }
    expect(() =>
      renderSlideMenuModulePreview(rendererWithFont(), asCanvas(canvas), slideMenuFrame())
    ).toThrow('draw failed')
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('registers and dispatches regular FRAME rendering while invalid identities fail closed', () => {
    expect(
      BUILTIN_MODULE_CANVAS_ADAPTERS.get(SLIDE_MENU_PLUGIN_ID, SLIDE_MENU_MODULE_TYPE)
    ).toBeDefined()
    const canvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    const renderer = rendererWithFont()
    renderShapeUncached(renderer, asCanvas(canvas), slideMenuFrame(), new SceneGraph())
    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(canvas.drawParagraph.mock.calls.map((call) => paragraphText(call[0]))).toEqual([
      'Open navigation'
    ])

    const invalid = slideMenuFrame({
      interactiveProps: {
        module: { ...createSlideMenuModuleInstance(), pluginId: 'unknown.plugin' }
      }
    })
    const invalidCanvas = { ...createMockCanvas(), drawParagraph: canvasMock('drawParagraph') }
    expect(renderSlideMenuModulePreview(renderer, asCanvas(invalidCanvas), invalid)).toBe(false)
    expect(invalidCanvas.drawRect).not.toHaveBeenCalled()
    expect(invalidCanvas.drawParagraph).not.toHaveBeenCalled()

    const invalidVersion = slideMenuFrame({
      interactiveProps: {
        module: { ...createSlideMenuModuleInstance(), configVersion: 3 }
      }
    })
    expect(renderSlideMenuModulePreview(renderer, asCanvas(invalidCanvas), invalidVersion)).toBe(
      false
    )
  })
})
