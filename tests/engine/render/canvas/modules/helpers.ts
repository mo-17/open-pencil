import { mock } from 'bun:test'

import type { Canvas, Paragraph } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import type { TextLayout } from '#core/canvas/text'

import { createMockRenderer } from '../effects/helpers'
import { asDouble } from '../helpers'

/** Deterministic shaping stand-in for geometry/resource tests; actual glyph coverage is tested with CanvasKit. */
function paragraph(node: SceneNode) {
  const slots = Math.max(0, Math.floor(node.width / 6))
  const letters = Array.from(node.text)
  const text =
    letters.length > slots ? letters.slice(0, Math.max(0, slots - 1)).join('') + '…' : node.text
  const prepared = {
    text,
    getAlphabeticBaseline: () => 0,
    getLongestLine: () => text.length * 6,
    getMaxIntrinsicWidth: () => text.length * 6,
    getHeight: () => 11,
    layout: () => undefined,
    delete: mock(() => undefined)
  }
  return {
    ...prepared,
    draw: (canvas: Canvas, x: number, y: number) =>
      canvas.drawParagraph(asDouble<Paragraph>(prepared), x, y)
  }
}

export function paragraphText(value: unknown): string {
  if (!value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string')
    throw new Error('Mock paragraph unavailable')
  return value.text
}

export function moduleTextRenderer(overrides: Partial<SkiaRenderer> = {}) {
  return createMockRenderer({
    zoom: 1,
    labelFont: { getSize: () => 11 } as SkiaRenderer['labelFont'],
    fontProvider: {} as SkiaRenderer['fontProvider'],
    fontsLoaded: true,
    nodeFontReadiness: mock(() => 'ready' as const),
    measureTextNode: mock((node: SceneNode) => ({
      width: paragraph(node).getLongestLine(),
      height: 11
    })),
    buildParagraph: mock((node: SceneNode) => asDouble<TextLayout>(paragraph(node))),
    ...overrides
  })
}
