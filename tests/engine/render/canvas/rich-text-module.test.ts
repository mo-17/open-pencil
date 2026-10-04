import { describe, expect, mock, spyOn, test } from 'bun:test'

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
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { carouselPixelHarness } from './carousel/helpers'
import { createMockCanvas } from './effects/helpers'
import { moduleTextRenderer, paragraphText } from './modules/helpers'

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
    const canvas = { ...createMockCanvas(), drawParagraph: mock(() => undefined) }
    const renderer = moduleTextRenderer()

    expect(renderRichTextModulePreview(renderer, canvas as Canvas, richTextFrame())).toBe(true)
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.clipRRect).toHaveBeenCalledTimes(1)
    expect(canvas.drawParagraph.mock.calls.map((call) => paragraphText(call[0]))).toEqual([
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
    const validCanvas = { ...createMockCanvas(), drawParagraph: mock(() => undefined) }
    const renderer = moduleTextRenderer()

    renderShapeUncached(renderer, validCanvas as Canvas, richTextFrame(), new SceneGraph())
    expect(renderer.drawNodeFill).toHaveBeenCalledTimes(1)
    expect(validCanvas.drawParagraph).toHaveBeenCalled()

    const invalidCanvas = { ...createMockCanvas(), drawParagraph: mock(() => undefined) }
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
    expect(invalidCanvas.drawParagraph).not.toHaveBeenCalled()
  })
})

test('RichText Canvas preflights and shapes authored CJK text at the configured font size', async () => {
  const h = await carouselPixelHarness(),
    graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createRichTextModuleFrameOverrides({
      content: {
        type: 'doc',
        blocks: [{ type: 'paragraph', align: 'left', children: [text('中文字号 Font size')] }]
      },
      fontSize: 32,
      lineHeight: 1.5
    })
  )
  const shaped: SceneNode[] = [],
    missing: string[] = [],
    build = h.renderer.buildParagraph.bind(h.renderer)
  const spy = spyOn(h.renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    const paragraph = build(label, color, options)
    shaped.push(label)
    missing.push(...missingGlyphCharacters(label.text, paragraph.getShapedLines()))
    return paragraph
  })
  try {
    expect(collectGraphFontRequirements(graph, [node.id]).scripts).toContain('cjk-sc')
    const original = structuredClone(node)
    renderRichTextModulePreview(h.renderer, h.canvas, node)
    expect(shaped.map((label) => label.text)).toContain('中文字号 Font size')
    expect(shaped.every((label) => label.fontSize === 32 && label.lineHeight === 48)).toBe(true)
    expect(missing).toEqual([])
    expect(node).toEqual(original)
    expect(h.renderer.labelFont?.getSize()).toBe(11)
  } finally {
    spy.mockRestore()
    h.dispose()
  }
})
