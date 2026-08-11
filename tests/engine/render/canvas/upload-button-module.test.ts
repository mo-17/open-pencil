import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import {
  BUILTIN_MODULE_CANVAS_ADAPTERS,
  renderUploadButtonModulePreview
} from '#core/canvas/modules'
import { renderShapeUncached } from '#core/canvas/scene'
import {
  UPLOAD_BUTTON_MODULE_TYPE,
  UPLOAD_BUTTON_PLUGIN_ID,
  createUploadButtonModuleFrameOverrides,
  createUploadButtonModuleInstance,
  type UploadButtonModuleConfig
} from '#core/plugins/upload-button'

import { createMockCanvas, createMockRenderer, type MockCanvasPath } from './effects/helpers'

const CONFIG: UploadButtonModuleConfig = {
  triggerLabel: 'Choose file',
  showTriggerIcon: true,
  showTriggerLabel: true,
  accept: [],
  multiple: false,
  maxFiles: 1,
  maxFileBytes: 10_485_760,
  allowDrop: true,
  showFileList: true,
  helperText: '',
  buttonBackground: '#2563EB',
  buttonTextColor: '#FFFFFF',
  accentColor: '#2563EB',
  errorColor: '#DC2626'
}

function uploadButtonFrame(
  overrides: Partial<SceneNode> = {},
  config: UploadButtonModuleConfig = CONFIG
): SceneNode {
  return createDefaultNode(() => 'upload-button-1', 'FRAME', {
    ...createUploadButtonModuleFrameOverrides(config),
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

function uploadPath(canvas: ReturnType<typeof createMockCanvas>): MockCanvasPath | undefined {
  return canvas.drawPath.mock.calls[0]?.[0] as MockCanvasPath | undefined
}

describe('upload button module canvas preview', () => {
  test('draws an offline inert centered local-file trigger and disposable vector icon', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.reject(new Error('Canvas preview must stay offline')))
    globalThis.fetch = fetchMock as typeof fetch
    try {
      expect(renderUploadButtonModulePreview(renderer, canvas as Canvas, uploadButtonFrame())).toBe(
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
      ['Choose file', 80, 28]
    ])
    expect(canvas.drawPath).toHaveBeenCalledTimes(1)
    const path = uploadPath(canvas)
    expect(path?.moveTo.mock.calls[0]).toEqual([62, 28])
    expect(path?.lineTo.mock.calls[3]).toEqual([63, 16])
    const shaftBottomY = path?.moveTo.mock.calls[0]?.[1] as number
    const arrowTipY = path?.lineTo.mock.calls[3]?.[1] as number
    expect(arrowTipY).toBeLessThan(shaftBottomY)
    expect(path?.close).toHaveBeenCalledTimes(2)
    expect(path?.delete).toHaveBeenCalledTimes(1)
    expect(renderer.color4f.mock.calls[0]).toEqual([37 / 255, 99 / 255, 235 / 255, 1])
    expect(renderer.color4f).toHaveBeenLastCalledWith(1, 1, 1, 1)
    expect(canvas.restore).toHaveBeenCalledTimes(1)
    expect(canvas.drawText.mock.calls.flat()).not.toContain('uploaded')
    expect(canvas.drawText.mock.calls.flat()).not.toContain('success')
  })

  test('renders label and upload icon independently while preserving centered content', () => {
    const cases = [
      {
        name: 'label and icon',
        showTriggerLabel: true,
        showTriggerIcon: true,
        expectedText: [['Choose file', 80, 28]],
        expectedIconLeft: 54
      },
      {
        name: 'label only',
        showTriggerLabel: true,
        showTriggerIcon: false,
        expectedText: [['Choose file', 67, 28]],
        expectedIconLeft: null
      },
      {
        name: 'icon only',
        showTriggerLabel: false,
        showTriggerIcon: true,
        expectedText: [],
        expectedIconLeft: 91
      }
    ] as const

    for (const visibility of cases) {
      const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
      expect(
        renderUploadButtonModulePreview(
          rendererWithFont(),
          canvas as Canvas,
          uploadButtonFrame(
            {},
            {
              ...CONFIG,
              showTriggerLabel: visibility.showTriggerLabel,
              showTriggerIcon: visibility.showTriggerIcon
            }
          )
        ),
        visibility.name
      ).toBe(true)
      expect(
        canvas.drawText.mock.calls.map((call) => call.slice(0, 3)),
        visibility.name
      ).toEqual(visibility.expectedText)
      if (visibility.expectedIconLeft === null) {
        expect(canvas.drawPath, visibility.name).not.toHaveBeenCalled()
      } else {
        expect(uploadPath(canvas)?.moveTo.mock.calls[0]?.[0], visibility.name).toBe(
          visibility.expectedIconLeft + 8
        )
      }
    }
  })

  test('uses configured button colors without drawing helper or file state', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()
    expect(
      renderUploadButtonModulePreview(
        renderer,
        canvas as Canvas,
        uploadButtonFrame(
          {},
          {
            ...CONFIG,
            helperText: 'PNG only',
            buttonBackground: '#102030',
            buttonTextColor: '#A0B0C0'
          }
        )
      )
    ).toBe(true)

    expect(renderer.color4f.mock.calls[0]).toEqual([16 / 255, 32 / 255, 48 / 255, 1])
    expect(renderer.color4f).toHaveBeenLastCalledWith(160 / 255, 176 / 255, 192 / 255, 1)
    expect(canvas.drawText.mock.calls.flat()).not.toContain('PNG only')
  })

  test('lets authored children replace the intrinsic trigger preview', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderUploadButtonModulePreview(
        rendererWithFont(),
        canvas as Canvas,
        uploadButtonFrame({ childIds: ['authored-trigger'] })
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
      renderUploadButtonModulePreview(
        createMockRenderer({ zoom: 1, labelFont: null }),
        fontlessCanvas as Canvas,
        uploadButtonFrame()
      )
    ).toBe(true)
    expect(fontlessCanvas.drawText).not.toHaveBeenCalled()
    expect(fontlessCanvas.drawPath).toHaveBeenCalledTimes(1)
    expect(fontlessCanvas.restore).toHaveBeenCalledTimes(1)

    const tinyCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderUploadButtonModulePreview(
        rendererWithFont(),
        tinyCanvas as Canvas,
        uploadButtonFrame({ width: 12, height: 10 })
      )
    ).toBe(true)
    expect(tinyCanvas.drawRect).toHaveBeenCalledTimes(1)
    expect(tinyCanvas.drawText).not.toHaveBeenCalled()
    expect(tinyCanvas.drawPath).not.toHaveBeenCalled()
    expect(tinyCanvas.restore).toHaveBeenCalledTimes(1)

    const emptyCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(
      renderUploadButtonModulePreview(
        rendererWithFont(),
        emptyCanvas as Canvas,
        uploadButtonFrame({ width: 0 })
      )
    ).toBe(true)
    expect(emptyCanvas.save).not.toHaveBeenCalled()
    expect(emptyCanvas.drawRect).not.toHaveBeenCalled()
  })

  test('ellipsizes a long trigger label while keeping the group centered', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const triggerLabel = 'Choose a local file from this device without transferring it'
    expect(
      renderUploadButtonModulePreview(
        rendererWithFont(),
        canvas as Canvas,
        uploadButtonFrame({}, { ...CONFIG, triggerLabel })
      )
    ).toBe(true)

    const [text, x, y] = canvas.drawText.mock.calls[0]
    expect(text).not.toBe(triggerLabel)
    expect(text).toEndWith('…')
    expect(y).toBe(28)
    const textWidth = String(text).length * 6
    expect(x).toBe((200 - (textWidth + 8 + 18)) / 2 + 18 + 8)
    expect(uploadPath(canvas)?.moveTo.mock.calls[0]?.[0]).toBe((200 - (textWidth + 8 + 18)) / 2 + 8)
  })

  test('cleans vector resources and restores the save stack when drawing fails', () => {
    const pathFailureCanvas = {
      ...createMockCanvas(),
      drawText: mock(() => undefined),
      drawPath: mock(() => {
        throw new Error('path failed')
      })
    }
    expect(() =>
      renderUploadButtonModulePreview(
        rendererWithFont(),
        pathFailureCanvas as Canvas,
        uploadButtonFrame()
      )
    ).toThrow('path failed')
    const failedPath = pathFailureCanvas.drawPath.mock.calls[0]?.[0] as MockCanvasPath
    expect(failedPath.delete).toHaveBeenCalledTimes(1)
    expect(pathFailureCanvas.restore).toHaveBeenCalledTimes(1)

    const textFailureCanvas = {
      ...createMockCanvas(),
      drawText: mock(() => {
        throw new Error('text failed')
      })
    }
    expect(() =>
      renderUploadButtonModulePreview(
        rendererWithFont(),
        textFailureCanvas as Canvas,
        uploadButtonFrame()
      )
    ).toThrow('text failed')
    expect(uploadPath(textFailureCanvas)?.delete).toHaveBeenCalledTimes(1)
    expect(textFailureCanvas.restore).toHaveBeenCalledTimes(1)
  })

  test('registers regular FRAME rendering while invalid identities fail closed', () => {
    expect(
      BUILTIN_MODULE_CANVAS_ADAPTERS.get(UPLOAD_BUTTON_PLUGIN_ID, UPLOAD_BUTTON_MODULE_TYPE)
    ).toBeDefined()
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()
    renderShapeUncached(renderer, canvas as Canvas, uploadButtonFrame(), new SceneGraph())
    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(canvas.drawText.mock.calls.map((call) => call[0])).toEqual(['Choose file'])

    const invalid = uploadButtonFrame({
      interactiveProps: {
        module: { ...createUploadButtonModuleInstance(), pluginId: 'unknown.plugin' }
      }
    })
    const invalidCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    expect(renderUploadButtonModulePreview(renderer, invalidCanvas as Canvas, invalid)).toBe(false)
    expect(invalidCanvas.drawRect).not.toHaveBeenCalled()
    expect(invalidCanvas.drawText).not.toHaveBeenCalled()
    expect(invalidCanvas.drawPath).not.toHaveBeenCalled()

    const invalidVersion = uploadButtonFrame({
      interactiveProps: {
        module: { ...createUploadButtonModuleInstance(), configVersion: 2 }
      }
    })
    expect(renderUploadButtonModulePreview(renderer, invalidCanvas as Canvas, invalidVersion)).toBe(
      false
    )
  })
})
