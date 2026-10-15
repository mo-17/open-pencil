import { describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { renderVideoModulePreview, videoPreviewLabel } from '#core/canvas/modules'
import { renderShapeUncached } from '#core/canvas/scene'
import {
  createVideoModuleFrameOverrides,
  createVideoModuleInstance,
  type VideoModuleConfigV1
} from '#core/plugins/video'

import {
  canvasMock,
  createMockCanvas,
  createMockRenderer
} from '#tests/engine/render/canvas/effects/helpers'
import { asCanvas } from '#tests/engine/render/canvas/helpers'

function videoFrame(overrides: Partial<SceneNode> = {}): SceneNode {
  return createDefaultNode(() => 'video-1', 'FRAME', {
    ...createVideoModuleFrameOverrides({
      src: 'https://media.example.com/demo.mp4',
      controls: true,
      muted: true,
      fit: 'cover'
    }),
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

describe('video module canvas preview', () => {
  test('builds an offline status label from validated config', () => {
    expect(
      videoPreviewLabel({
        src: 'https://media.example.com/demo.mp4',
        poster: '',
        controls: true,
        autoplay: false,
        muted: true,
        loop: true,
        fit: 'cover'
      } satisfies VideoModuleConfigV1)
    ).toBe('media.example.com · cover · controls · muted · loop')
  })

  test('draws a deterministic placeholder without a media loader', () => {
    const canvas = { ...createMockCanvas(), drawText: canvasMock('drawText') }
    const renderer = rendererWithFont()

    expect(renderVideoModulePreview(renderer, asCanvas(canvas), videoFrame())).toBe(true)
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawPath).toHaveBeenCalledTimes(1)
    expect(canvas.drawCircle).toHaveBeenCalledTimes(2)
    expect(canvas.drawText).toHaveBeenCalledTimes(1)
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('regular FRAME rendering dispatches video and invalid identities fail closed', () => {
    const canvas = { ...createMockCanvas(), drawText: canvasMock('drawText') }
    const renderer = rendererWithFont()
    renderShapeUncached(renderer, asCanvas(canvas), videoFrame(), new SceneGraph())
    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(canvas.drawPath).toHaveBeenCalledTimes(1)

    const invalid = videoFrame({
      interactiveProps: {
        module: { ...createVideoModuleInstance(), pluginId: 'unknown.plugin' }
      }
    })
    const invalidCanvas = { ...createMockCanvas(), drawText: canvasMock('drawText') }
    expect(renderVideoModulePreview(renderer, asCanvas(invalidCanvas), invalid)).toBe(false)
    expect(invalidCanvas.drawPath).not.toHaveBeenCalled()
  })
})
