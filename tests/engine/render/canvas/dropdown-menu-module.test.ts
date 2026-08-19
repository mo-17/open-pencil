import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import {
  BUILTIN_MODULE_CANVAS_ADAPTERS,
  renderDropdownMenuModulePreview
} from '#core/canvas/modules'
import { renderShapeUncached } from '#core/canvas/scene'
import {
  DROPDOWN_MENU_MODULE_TYPE,
  DROPDOWN_MENU_PLUGIN_ID,
  createDropdownMenuModuleFrameOverrides,
  createDropdownMenuModuleInstance,
  type DropdownMenuModuleConfig
} from '#core/plugins/dropdown-menu'

import { createMockCanvas, createMockRenderer, type MockCanvasPath } from './effects/helpers'

const CONFIG: DropdownMenuModuleConfig = {
  triggerLabel: 'Open menu',
  showTriggerLabel: true,
  showTriggerChevron: true,
  triggerMode: 'click',
  placement: 'bottomLeft',
  items: [
    {
      type: 'item',
      label: 'Dashboard',
      href: '/',
      disabled: false,
      danger: false,
      shortcut: ''
    }
  ],
  closeOnSelect: true,
  closeOnEscape: true,
  closeOnOutsidePress: true,
  menuWidth: 240,
  triggerBackground: '#2563EB',
  triggerTextColor: '#FFFFFF',
  menuBackground: '#FFFFFF',
  itemTextColor: '#111827',
  accentColor: '#2563EB',
  dangerColor: '#DC2626'
}

function dropdownMenuFrame(
  overrides: Partial<SceneNode> = {},
  config: DropdownMenuModuleConfig = CONFIG
): SceneNode {
  return createDefaultNode(() => 'dropdown-menu-1', 'FRAME', {
    ...createDropdownMenuModuleFrameOverrides(config),
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

function chevronPath(canvas: ReturnType<typeof createMockCanvas>): MockCanvasPath | undefined {
  return canvas.drawPath.mock.calls[0]?.[0] as MockCanvasPath | undefined
}

describe('dropdown menu module canvas preview', () => {
  test('draws an offline inert centered trigger and vector chevron', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.reject(new Error('Canvas preview must stay offline')))
    globalThis.fetch = fetchMock as typeof fetch
    try {
      expect(renderDropdownMenuModulePreview(renderer, canvas as Canvas, dropdownMenuFrame())).toBe(
        true
      )
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawText.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['Open menu', 52, 28]
    ])
    expect(canvas.drawPath).toHaveBeenCalledTimes(1)
    const path = chevronPath(canvas)
    const builder = path?.sourceBuilder
    expect(builder?.moveTo.mock.calls).toEqual([[114, 20]])
    expect(builder?.lineTo.mock.calls[0]).toEqual([121, 28])
    expect(builder?.lineTo.mock.calls[1]).toEqual([128, 20])
    expect(builder?.close).toHaveBeenCalledTimes(1)
    expect(builder?.detachAndDelete).toHaveBeenCalledTimes(1)
    expect(path?.delete).toHaveBeenCalledTimes(1)
    expect(renderer.color4f.mock.calls[0]).toEqual([37 / 255, 99 / 255, 235 / 255, 1])
    expect(renderer.color4f).toHaveBeenLastCalledWith(1, 1, 1, 1)
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('renders label and chevron independently while preserving centered content', () => {
    const cases = [
      {
        name: 'label and chevron',
        showTriggerLabel: true,
        showTriggerChevron: true,
        expectedText: [['Open menu', 52, 28]],
        expectedChevronLeft: 114
      },
      {
        name: 'label only',
        showTriggerLabel: true,
        showTriggerChevron: false,
        expectedText: [['Open menu', 63, 28]],
        expectedChevronLeft: null
      },
      {
        name: 'chevron only',
        showTriggerLabel: false,
        showTriggerChevron: true,
        expectedText: [],
        expectedChevronLeft: 83
      }
    ] as const

    for (const visibility of cases) {
      const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
      expect(
        renderDropdownMenuModulePreview(
          rendererWithFont(),
          canvas as Canvas,
          dropdownMenuFrame(
            {},
            {
              ...CONFIG,
              showTriggerLabel: visibility.showTriggerLabel,
              showTriggerChevron: visibility.showTriggerChevron
            }
          )
        ),
        visibility.name
      ).toBe(true)
      expect(
        canvas.drawText.mock.calls.map((call) => call.slice(0, 3)),
        visibility.name
      ).toEqual(visibility.expectedText)
      if (visibility.expectedChevronLeft === null) {
        expect(canvas.drawPath, visibility.name).not.toHaveBeenCalled()
      } else {
        expect(chevronPath(canvas)?.sourceBuilder?.moveTo.mock.calls[0]?.[0], visibility.name).toBe(
          visibility.expectedChevronLeft
        )
      }
    }
  })

  test('uses configured trigger colors without drawing popup items', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()
    expect(
      renderDropdownMenuModulePreview(
        renderer,
        canvas as Canvas,
        dropdownMenuFrame(
          {},
          { ...CONFIG, triggerBackground: '#102030', triggerTextColor: '#A0B0C0' }
        )
      )
    ).toBe(true)

    expect(renderer.color4f.mock.calls[0]).toEqual([16 / 255, 32 / 255, 48 / 255, 1])
    expect(renderer.color4f).toHaveBeenLastCalledWith(160 / 255, 176 / 255, 192 / 255, 1)
    expect(canvas.drawText.mock.calls.flat()).not.toContain('Dashboard')
  })

  test('lets authored children replace the intrinsic trigger preview', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderDropdownMenuModulePreview(
        rendererWithFont(),
        canvas as Canvas,
        dropdownMenuFrame({ childIds: ['authored-trigger'] })
      )
    ).toBe(true)
    expect(canvas.save).not.toHaveBeenCalled()
    expect(canvas.drawRect).not.toHaveBeenCalled()
    expect(canvas.drawText).not.toHaveBeenCalled()
    expect(canvas.drawPath).not.toHaveBeenCalled()
  })

  test('keeps fontless, tiny, and empty frames inert and balanced', () => {
    const fontlessCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderDropdownMenuModulePreview(
        createMockRenderer({ zoom: 1, labelFont: null }),
        fontlessCanvas as Canvas,
        dropdownMenuFrame()
      )
    ).toBe(true)
    expect(fontlessCanvas.drawText).not.toHaveBeenCalled()
    expect(fontlessCanvas.drawPath).toHaveBeenCalledTimes(1)
    expect(fontlessCanvas.restore).toHaveBeenCalledTimes(1)

    const tinyCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderDropdownMenuModulePreview(
        rendererWithFont(),
        tinyCanvas as Canvas,
        dropdownMenuFrame({ width: 12, height: 10 })
      )
    ).toBe(true)
    expect(tinyCanvas.drawRect).toHaveBeenCalledTimes(1)
    expect(tinyCanvas.drawText).not.toHaveBeenCalled()
    expect(tinyCanvas.drawPath).not.toHaveBeenCalled()
    expect(tinyCanvas.restore).toHaveBeenCalledTimes(1)

    const emptyCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderDropdownMenuModulePreview(
        rendererWithFont(),
        emptyCanvas as Canvas,
        dropdownMenuFrame({ width: 0 })
      )
    ).toBe(true)
    expect(emptyCanvas.save).not.toHaveBeenCalled()
    expect(emptyCanvas.drawRect).not.toHaveBeenCalled()
  })

  test('ellipsizes a long trigger label while keeping the group centered', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const triggerLabel = 'Open the complete dropdown menu for this workspace'
    expect(
      renderDropdownMenuModulePreview(
        rendererWithFont(),
        canvas as Canvas,
        dropdownMenuFrame({}, { ...CONFIG, triggerLabel })
      )
    ).toBe(true)

    const [text, x, y] = canvas.drawText.mock.calls[0]
    expect(text).not.toBe(triggerLabel)
    expect(text).toEndWith('…')
    expect(y).toBe(28)
    const textWidth = String(text).length * 6
    expect(x).toBe((180 - (textWidth + 8 + 14)) / 2)
    expect(chevronPath(canvas)?.sourceBuilder?.moveTo.mock.calls[0]?.[0]).toBe(
      Number(x) + textWidth + 8
    )
  })

  test('restores the Canvas save stack when label drawing fails', () => {
    const canvas = {
      ...createMockCanvas(),
      drawText: mock(() => {
        throw new Error('draw failed')
      })
    }
    expect(() =>
      renderDropdownMenuModulePreview(rendererWithFont(), canvas as Canvas, dropdownMenuFrame())
    ).toThrow('draw failed')
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('registers regular FRAME rendering while invalid identities fail closed', () => {
    expect(
      BUILTIN_MODULE_CANVAS_ADAPTERS.get(DROPDOWN_MENU_PLUGIN_ID, DROPDOWN_MENU_MODULE_TYPE)
    ).toBeDefined()
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()
    renderShapeUncached(renderer, canvas as Canvas, dropdownMenuFrame(), new SceneGraph())
    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(canvas.drawText.mock.calls.map((call) => call[0])).toEqual(['Open menu'])

    const invalid = dropdownMenuFrame({
      interactiveProps: {
        module: { ...createDropdownMenuModuleInstance(), pluginId: 'unknown.plugin' }
      }
    })
    const invalidCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(renderDropdownMenuModulePreview(renderer, invalidCanvas as Canvas, invalid)).toBe(false)
    expect(invalidCanvas.drawRect).not.toHaveBeenCalled()
    expect(invalidCanvas.drawText).not.toHaveBeenCalled()
    expect(invalidCanvas.drawPath).not.toHaveBeenCalled()

    const invalidVersion = dropdownMenuFrame({
      interactiveProps: {
        module: { ...createDropdownMenuModuleInstance(), configVersion: 2 }
      }
    })
    expect(renderDropdownMenuModulePreview(renderer, invalidCanvas as Canvas, invalidVersion)).toBe(
      false
    )
  })
})
