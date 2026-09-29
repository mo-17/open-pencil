import { describe, expect, mock, test } from 'bun:test'

import type { Canvas, Paragraph, TypefaceFontProvider } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { BUILTIN_MODULE_CANVAS_ADAPTERS, renderModalModulePreview } from '#core/canvas/modules'
import { renderShapeUncached } from '#core/canvas/scene'
import {
  MODAL_MODULE_TYPE,
  MODAL_PLUGIN_ID,
  createModalModuleFrameOverrides,
  createModalModuleInstance,
  type ModalModuleConfig
} from '#core/plugins/modal'

import { createMockCanvas, createMockRenderer } from '#tests/engine/render/canvas/effects/helpers'

const CONFIG: ModalModuleConfig = {
  triggerLabel: 'Open modal',
  showTriggerIcon: true,
  showTriggerLabel: true,
  title: 'Modal title',
  content: 'This content belongs to the generated dialog, not the Canvas trigger.',
  showCloseButton: true,
  closeOnBackdrop: true,
  closeOnEscape: true,
  showCancelButton: true,
  cancelLabel: 'Cancel',
  showConfirmButton: true,
  confirmLabel: 'Confirm',
  panelWidth: 520,
  footerAlign: 'right',
  panelBackground: '#FFFFFF',
  textColor: '#111827',
  accentColor: '#2563EB',
  overlayOpacity: 0.45
}

function modalFrame(
  overrides: Partial<SceneNode> = {},
  config: ModalModuleConfig = CONFIG
): SceneNode {
  return createDefaultNode(() => 'modal-1', 'FRAME', {
    ...createModalModuleFrameOverrides(config),
    ...overrides
  })
}

function rendererWithFont() {
  return createMockRenderer({
    zoom: 1,
    fontProvider: {} as TypefaceFontProvider,
    fontsLoaded: true,
    nodeFontReadiness: () => 'ready',
    buildParagraph: (node) => {
      const maximum = Math.max(0, Math.floor(node.width / 6))
      const text = node.text.length <= maximum ? node.text : `${node.text.slice(0, maximum - 1)}…`
      return {
        text,
        getLongestLine: () => text.length * 6,
        getHeight: () => 16,
        delete: mock(() => undefined)
      } as Paragraph
    }
  })
}

interface RecordedParagraph extends Paragraph {
  text: string
}

function moduleCanvas() {
  const drawText = mock((_text: string, _x: number, _baseline: number) => undefined)
  return {
    ...createMockCanvas(),
    // Keep label assertions expressed in baseline coordinates while exercising paragraph drawing.
    drawText,
    drawParagraph: mock((paragraph: RecordedParagraph, x: number, top: number) => {
      drawText(paragraph.text, x, top + 12)
    })
  }
}

function iconRects(canvas: ReturnType<typeof createMockCanvas>) {
  return canvas.drawRect.mock.calls.map((call) => Array.from(call[0]))
}

describe('modal module canvas preview', () => {
  test('draws an offline inert trigger without rendering or requesting modal content', () => {
    const canvas = moduleCanvas()
    const renderer = rendererWithFont()
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.reject(new Error('Canvas preview must stay offline')))
    globalThis.fetch = fetchMock as typeof fetch
    try {
      expect(renderModalModulePreview(renderer, canvas as Canvas, modalFrame())).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawRect).toHaveBeenCalledTimes(5)
    expect(iconRects(canvas)).toEqual([
      [47, 17, 65, 19],
      [47, 29, 65, 31],
      [47, 17, 49, 31],
      [63, 17, 65, 31],
      [49, 21, 63, 23]
    ])
    expect(canvas.drawText.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['Open modal', 73, 28]
    ])
    expect(canvas.drawText.mock.calls.flat()).not.toContain(CONFIG.content)
    expect(renderer.color4f.mock.calls).not.toContainEqual([38 / 255, 99 / 255, 235 / 255, 1])
    expect(renderer.color4f).toHaveBeenLastCalledWith(1, 1, 1, 1)
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('renders every independent trigger icon and label visibility combination', () => {
    const cases = [
      {
        name: 'icon and label',
        showTriggerIcon: true,
        showTriggerLabel: true,
        expectedIconLeft: 47,
        expectedText: [['Open modal', 73, 28]],
        expectedColorCalls: 2
      },
      {
        name: 'icon only',
        showTriggerIcon: true,
        showTriggerLabel: false,
        expectedIconLeft: 81,
        expectedText: [],
        expectedColorCalls: 1
      },
      {
        name: 'label only',
        showTriggerIcon: false,
        showTriggerLabel: true,
        expectedIconLeft: null,
        expectedText: [['Open modal', 60, 28]],
        expectedColorCalls: 1
      },
      {
        name: 'background only',
        showTriggerIcon: false,
        showTriggerLabel: false,
        expectedIconLeft: null,
        expectedText: [],
        expectedColorCalls: 0
      }
    ] as const

    for (const visibility of cases) {
      const canvas = moduleCanvas()
      const renderer = rendererWithFont()
      expect(
        renderModalModulePreview(
          renderer,
          canvas as Canvas,
          modalFrame(
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
      const rects = iconRects(canvas)
      const expectedIconLeft = visibility.expectedIconLeft
      if (expectedIconLeft === null) {
        expect(rects, visibility.name).toEqual([])
      } else {
        expect(rects, visibility.name).toHaveLength(5)
        expect(
          rects.every((rect) => rect[0] >= expectedIconLeft),
          visibility.name
        ).toBe(true)
        expect(rects[0]?.[0], visibility.name).toBe(expectedIconLeft)
      }
      expect(
        canvas.drawText.mock.calls.map((call) => call.slice(0, 3)),
        visibility.name
      ).toEqual(visibility.expectedText)
      expect(renderer.color4f, visibility.name).toHaveBeenCalledTimes(visibility.expectedColorCalls)
    }
  })

  test('legacy authored children without a content-slot field replace the intrinsic trigger preview', () => {
    const canvas = moduleCanvas()
    expect(
      renderModalModulePreview(
        rendererWithFont(),
        canvas as Canvas,
        modalFrame({
          childIds: ['authored-trigger'],
          interactiveProps: { module: { ...createModalModuleInstance(), config: CONFIG } }
        })
      )
    ).toBe(true)
    expect(canvas.save).not.toHaveBeenCalled()
    expect(canvas.drawRect).not.toHaveBeenCalled()
    expect(canvas.drawText).not.toHaveBeenCalled()
  })

  test.each(['Body', '', 'Missing'])(
    'explicit content slot %s preserves the configured trigger even with authored children',
    (contentChildName) => {
      const canvas = moduleCanvas()
      expect(
        renderModalModulePreview(
          rendererWithFont(),
          canvas as Canvas,
          modalFrame(
            { childIds: ['dialog-body', 'unmapped-child'] },
            { ...CONFIG, contentChildName, triggerLabel: '编辑资料' }
          )
        )
      ).toBe(true)
      expect(canvas.drawText.mock.calls.map((call) => call[0])).toEqual(['编辑资料'])
      expect(canvas.drawRect).toHaveBeenCalledTimes(5)
    }
  )

  test('keeps small, fontless, and empty frames inert and balanced', () => {
    const renderer = rendererWithFont()
    const fontlessCanvas = moduleCanvas()
    expect(
      renderModalModulePreview(
        createMockRenderer({ zoom: 1, labelFont: null }),
        fontlessCanvas as Canvas,
        modalFrame()
      )
    ).toBe(true)
    expect(fontlessCanvas.drawText).not.toHaveBeenCalled()
    expect(fontlessCanvas.drawRect).toHaveBeenCalledTimes(5)
    expect(fontlessCanvas.restore).toHaveBeenCalledTimes(1)

    const tinyCanvas = moduleCanvas()
    expect(
      renderModalModulePreview(
        renderer,
        tinyCanvas as Canvas,
        modalFrame({ width: 20, height: 10 })
      )
    ).toBe(true)
    expect(tinyCanvas.drawRect).not.toHaveBeenCalled()
    expect(tinyCanvas.drawText).not.toHaveBeenCalled()
    expect(tinyCanvas.restore).toHaveBeenCalledTimes(1)

    const emptyCanvas = moduleCanvas()
    expect(
      renderModalModulePreview(renderer, emptyCanvas as Canvas, modalFrame({ width: 0 }))
    ).toBe(true)
    expect(emptyCanvas.save).not.toHaveBeenCalled()
    expect(emptyCanvas.drawRect).not.toHaveBeenCalled()
  })

  test('ellipsizes a long trigger label while keeping the icon-label group centered', () => {
    const canvas = moduleCanvas()
    const renderer = rendererWithFont()
    const triggerLabel = 'Open the complete modal dialog for this workspace'
    expect(
      renderModalModulePreview(
        renderer,
        canvas as Canvas,
        modalFrame({}, { ...CONFIG, triggerLabel })
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
      drawParagraph: mock(() => {
        throw new Error('draw failed')
      })
    }
    expect(() =>
      renderModalModulePreview(rendererWithFont(), canvas as Canvas, modalFrame())
    ).toThrow('draw failed')
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('registers regular FRAME rendering while invalid identities fail closed', () => {
    expect(BUILTIN_MODULE_CANVAS_ADAPTERS.get(MODAL_PLUGIN_ID, MODAL_MODULE_TYPE)).toBeDefined()
    const canvas = moduleCanvas()
    const renderer = rendererWithFont()
    renderShapeUncached(renderer, canvas as Canvas, modalFrame(), new SceneGraph())
    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(canvas.drawText.mock.calls.map((call) => call[0])).toEqual(['Open modal'])

    const invalid = modalFrame({
      interactiveProps: {
        module: { ...createModalModuleInstance(), pluginId: 'unknown.plugin' }
      }
    })
    const invalidCanvas = moduleCanvas()
    expect(renderModalModulePreview(renderer, invalidCanvas as Canvas, invalid)).toBe(false)
    expect(invalidCanvas.drawRect).not.toHaveBeenCalled()
    expect(invalidCanvas.drawText).not.toHaveBeenCalled()

    const invalidVersion = modalFrame({
      interactiveProps: {
        module: { ...createModalModuleInstance(), configVersion: 2 }
      }
    })
    expect(renderModalModulePreview(renderer, invalidCanvas as Canvas, invalidVersion)).toBe(false)
  })
})
