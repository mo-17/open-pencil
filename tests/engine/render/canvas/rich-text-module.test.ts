import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { renderRichTextModulePreview, richTextPreviewLines } from '#core/canvas/modules'
import { renderShapeUncached } from '#core/canvas/scene'
import {
  createRichTextModuleFrameOverrides,
  createRichTextModuleInstance,
  type RichTextModuleConfigV1
} from '#core/plugins/rich-text'

import { createMockCanvas, createMockRenderer } from './effects/helpers'

function text(value: string, marks: Record<string, unknown>[] = []) {
  return { type: 'text', text: value, marks }
}

function richTextFrame(overrides: Partial<SceneNode> = {}): SceneNode {
  return createDefaultNode(() => 'rich-text-1', 'FRAME', {
    ...createRichTextModuleFrameOverrides({
      content: {
        type: 'doc',
        blocks: [
          { type: 'heading', level: 2, align: 'center', children: [text('Guide')] },
          {
            type: 'paragraph',
            align: 'right',
            children: [text('Documentation', [{ type: 'link', href: '/docs' }])]
          },
          { type: 'blockquote', children: [text('Stay structured')] },
          { type: 'codeBlock', language: 'ts', text: 'const safe = true\nreturn safe' },
          {
            type: 'orderedList',
            items: [{ children: [text('First')] }, { children: [text('Second')] }]
          }
        ]
      }
    }),
    width: 640,
    height: 480,
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

describe('rich text module canvas preview', () => {
  test('collapses every supported block into deterministic offline preview lines', () => {
    const module = createRichTextModuleInstance({
      content: {
        type: 'doc',
        blocks: [
          { type: 'heading', level: 3, align: 'center', children: [text('Title')] },
          { type: 'paragraph', align: 'left', children: [text('Body')] },
          { type: 'blockquote', children: [text('Quote')] },
          { type: 'codeBlock', language: 'ts', text: 'one\ntwo' },
          { type: 'bulletList', items: [{ children: [text('Item')] }] }
        ]
      }
    })
    const lines = richTextPreviewLines(module.config as RichTextModuleConfigV1)

    expect(lines.map((line) => line.text)).toEqual([
      '### Title',
      'Body',
      '> Quote',
      '› one',
      '› two',
      '• Item'
    ])
  })

  test('draws bounded lines through the registered module preview', () => {
    const canvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()

    expect(renderRichTextModulePreview(renderer, canvas as Canvas, richTextFrame())).toBe(true)
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawText.mock.calls.map((call) => call[0])).toEqual([
      '## Guide',
      'Documentation',
      '> Stay structured',
      '› const safe = true',
      '› return safe',
      '1. First',
      '2. Second'
    ])
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('regular FRAME rendering dispatches rich text and invalid identities fail closed', () => {
    const validCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const renderer = rendererWithFont()

    renderShapeUncached(renderer, validCanvas as Canvas, richTextFrame(), new SceneGraph())
    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(validCanvas.drawText).toHaveBeenCalled()

    const invalidCanvas = { ...createMockCanvas(), drawText: mock(() => undefined) }
    const invalid = richTextFrame({
      interactiveProps: {
        module: {
          version: 1,
          pluginId: 'unknown.plugin',
          moduleType: 'rich-text',
          configVersion: 1,
          config: {}
        }
      }
    })
    expect(renderRichTextModulePreview(renderer, invalidCanvas as Canvas, invalid)).toBe(false)
    expect(invalidCanvas.drawText).not.toHaveBeenCalled()
  })
})
