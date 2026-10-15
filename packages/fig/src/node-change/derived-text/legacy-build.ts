import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { normalizeFontFamily, weightToStyle, type SceneNode } from '@open-pencil/scene-graph'

import { bytesToHex } from '../bytes'
import type { FigNodeChangeExportRuntime } from '../export/runtime'
import { encodePathCommandsBlob } from '../path/commands'
import { alignGeneratedSingleLineGlyphs, generatedBaselineWithinLine } from './alignment'
import { buildDerivedTextData as buildSharedDerivedTextData } from './data'
import { buildDerivedTextFontMetaData } from './font-metadata'
import { storedGlyphCommands } from './glyphs'

function appendGlyphBlob(
  blobs: Uint8Array[],
  glyphBlobMap: Map<string, number>,
  blob: Uint8Array
): number {
  const key = bytesToHex(blob)
  const existing = glyphBlobMap.get(key)
  if (existing !== undefined) return existing
  const index = blobs.push(blob) - 1
  glyphBlobMap.set(key, index)
  return index
}

function generatedGlyphMetrics(
  node: SceneNode,
  runtime: FigNodeChangeExportRuntime,
  enabled: boolean
) {
  if (!enabled) return []
  return (
    runtime.getGlyphOutlineMetrics?.(
      node.fontFamily,
      weightToStyle(node.fontWeight, node.italic),
      node.text,
      node.fontSize
    ) ?? []
  )
}

function storedGlyphs(
  derivedGlyphs: NonNullable<SceneNode['derivedTextGlyphs']>,
  blobs: Uint8Array[],
  glyphBlobMap: Map<string, number>,
  glyphAdvance: number
) {
  return derivedGlyphs.map((glyph, index) => ({
    commandsBlob: appendGlyphBlob(blobs, glyphBlobMap, storedGlyphCommands(glyph)),
    position: { x: glyph.x, y: glyph.y },
    fontSize: glyph.fontSize,
    firstCharacter: index,
    advance:
      index + 1 < derivedGlyphs.length
        ? Math.max(derivedGlyphs[index + 1].x - glyph.x, 0)
        : glyphAdvance,
    // Preserve path-text radians; hardcoding 0 used to flatten circular text on re-export.
    rotation: glyph.rotation ?? 0
  }))
}

export function buildLegacyDerivedTextData(
  node: SceneNode,
  digestMap: Map<string, Uint8Array>,
  blobs: Uint8Array[],
  glyphBlobMap: Map<string, number>,
  runtime: FigNodeChangeExportRuntime,
  generateMissingGlyphs: boolean
): NodeChange['derivedTextData'] {
  const fontMeta = buildDerivedTextFontMetaData(node, digestMap, runtime)

  const lineHeight = node.lineHeight ?? Math.ceil(node.fontSize * 1.2)
  const verticalMetrics = runtime.getFontVerticalMetrics?.(
    normalizeFontFamily(node.fontFamily),
    weightToStyle(node.fontWeight, node.italic),
    node.fontSize
  )
  const baselineWithinLine = generatedBaselineWithinLine(lineHeight, verticalMetrics)
  const characterCount = Array.from(node.text).length
  const glyphAdvance = characterCount > 0 ? node.width / characterCount : 0

  const derivedGlyphs = node.derivedTextGlyphs ?? []
  const glyphs =
    derivedGlyphs.length > 0
      ? storedGlyphs(derivedGlyphs, blobs, glyphBlobMap, glyphAdvance)
      : generatedGlyphMetrics(node, runtime, generateMissingGlyphs).map((glyph, index) => ({
          commandsBlob: appendGlyphBlob(
            blobs,
            glyphBlobMap,
            encodePathCommandsBlob(glyph.commands, node.fontSize)
          ),
          position: { x: glyph.x, y: baselineWithinLine },
          fontSize: node.fontSize,
          firstCharacter: index,
          advance: glyph.advance,
          rotation: 0
        }))

  const generatedAlignment =
    derivedGlyphs.length === 0 ? alignGeneratedSingleLineGlyphs(node, glyphs, lineHeight) : null

  const alignment = generatedAlignment ?? {
    baselineY: baselineWithinLine,
    baselineX: undefined,
    lineY: undefined,
    lineWidth: node.width,
    logicalOffsets: []
  }
  const logicalIndexToCharacterOffsetMap =
    alignment.logicalOffsets.length === characterCount
      ? alignment.logicalOffsets
      : Array.from({ length: characterCount }, (_, index) => index * glyphAdvance)

  const data = buildSharedDerivedTextData({
    node,
    glyphs,
    fontMetaData: fontMeta,
    baseline: alignment.baselineY,
    baselineX: alignment.baselineX,
    baselineLineY: alignment.lineY,
    width: alignment.lineWidth,
    lineHeight: Math.max(lineHeight, verticalMetrics?.naturalLineHeight ?? 0),
    lineAscent: Math.floor(
      verticalMetrics?.ascent ?? Math.max(lineHeight - node.fontSize * 0.2, 0)
    ),
    logicalIndexToCharacterOffsetMap
  })
  if (data && glyphs.length === 0) delete data.glyphs
  return data
}
