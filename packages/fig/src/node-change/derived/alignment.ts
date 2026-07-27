import type { SceneNode } from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import type { FigFontVerticalMetrics } from '../export-runtime'

export interface GeneratedGlyphPosition {
  position: Vector
  advance: number
}

export interface GeneratedGlyphAlignment {
  baselineX: number
  baselineY: number
  lineY: number
  lineWidth: number
  logicalOffsets: number[]
}

export function generatedBaselineWithinLine(
  lineHeight: number,
  metrics: FigFontVerticalMetrics | null | undefined
): number {
  if (!metrics) return lineHeight
  return (lineHeight - metrics.naturalLineHeight) / 2 + metrics.ascent
}

export function alignGeneratedSingleLineGlyphs(
  node: SceneNode,
  glyphs: GeneratedGlyphPosition[],
  lineHeight: number
): GeneratedGlyphAlignment | null {
  if (glyphs.length === 0 || node.text.includes('\n')) return null

  const firstX = glyphs[0].position.x
  const baselineWithinLine = glyphs[0].position.y
  const lastGlyph = glyphs.at(-1)
  if (!lastGlyph) return null
  const lineWidth = Math.max(lastGlyph.position.x + Math.max(lastGlyph.advance, 0) - firstX, 0)
  const characters = Array.from(node.text)
  let lastAlignedIndex = characters.findLastIndex((character) => !/\s/u.test(character))
  if (lastAlignedIndex < 0) lastAlignedIndex = glyphs.length - 1
  const lastAlignedGlyph = glyphs[Math.min(lastAlignedIndex, glyphs.length - 1)]
  const alignmentWidth = Math.max(
    lastAlignedGlyph.position.x + Math.max(lastAlignedGlyph.advance, 0) - firstX,
    0
  )

  let baselineX = 0
  if (node.textAlignHorizontal === 'CENTER') baselineX = (node.width - alignmentWidth) / 2
  else if (node.textAlignHorizontal === 'RIGHT') baselineX = node.width - alignmentWidth

  let lineY = 0
  if (node.textAlignVertical === 'CENTER') lineY = (node.height - lineHeight) / 2
  else if (node.textAlignVertical === 'BOTTOM') lineY = node.height - lineHeight

  const logicalOffsets = glyphs.map((glyph) => glyph.position.x - firstX)
  const advanceScale = node.fontSize > 0 ? node.fontSize : 1
  for (const glyph of glyphs) {
    glyph.position.x += baselineX - firstX
    glyph.position.y += lineY
    glyph.advance /= advanceScale
  }

  return {
    baselineX,
    baselineY: baselineWithinLine + lineY,
    lineY,
    lineWidth,
    logicalOffsets
  }
}
