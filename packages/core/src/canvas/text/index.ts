import type {
  CanvasKit,
  FontWeight,
  Paint,
  Paragraph,
  TextFontFeatures,
  TextFontVariations,
  TypefaceFontProvider
} from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { resolveRGBAForPreview } from '#core/color/management'
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '#core/constants'
import { transformTextCase } from '#core/text/case'
import { resolveNodeTextDirection } from '#core/text/direction'
import { fontManager, weightToStyle } from '#core/text/fonts'
import { firstVisibleSolidTextFill } from '#core/text/paint'
import { requiredNodeFontFaces } from '#core/text/requirements'
import {
  fontCoverageDemand,
  fontCandidateCoverageText,
  fontFaceDemand,
  fontRemoteCoverageDemand,
  fontResolver,
  missingGlyphOccurrences,
  type FontResolutionDemand,
  missingGlyphsByScript,
  type FontResolutionSettled
} from '#core/text/resolver'

import { resolveParagraphFontFamilies } from './font-families'
import { pushParagraphStyle, type ParagraphPaintStyle, type ParagraphBuildOptions } from './paint'
import { withPreparedText } from './prepared'
export { withTextParagraph } from './prepared'
export type { ParagraphBuildOptions } from './paint'
import type { ParagraphNode } from './paragraph-inputs'
import type { TextPreparationCache } from './preparation-cache'

interface FontReadinessRenderer {
  textPreparationCache?: TextPreparationCache
  ck?: CanvasKit
  fontProvider?: TypefaceFontProvider | null
  fontsLoaded?: boolean
  onFontResolutionSettled?: FontResolutionSettled
  trackFontDemand?: (node: SceneNode, key: string) => void
}

interface TextRenderer extends FontReadinessRenderer {
  ck: CanvasKit
  fontProvider: TypefaceFontProvider | null
  fontsLoaded: boolean
}

function demandFace(
  r: FontReadinessRenderer,
  node: SceneNode,
  family: string,
  style: string
): boolean {
  if (fontManager.isStyleLoaded(family, style)) return true
  const demand = fontFaceDemand(family, style, node.text)
  r.trackFontDemand?.(node, demand.key)
  void fontResolver.demandForNode(demand, node.id, r.onFontResolutionSettled)
  return false
}

function languageForCharacter(node: SceneNode, sourceIndex: number): string | null {
  const run = node.styleRuns.find(
    (item) => sourceIndex >= item.start && sourceIndex < item.start + item.length
  )
  return run?.style.textLanguage ?? node.textLanguage
}

function transformedSourceOffsets(node: SceneNode): number[] {
  const offsets: number[] = []
  let sourceIndex = 0
  for (const sourceCharacter of node.text) {
    for (const _character of transformTextCase(sourceCharacter, node.textCase)) {
      offsets.push(sourceIndex)
    }
    sourceIndex += sourceCharacter.length
  }
  return offsets
}

export type NodeFontReadiness = 'ready' | 'substituted' | 'pending' | 'exhausted'

function requiredFacesReadiness(r: FontReadinessRenderer, node: SceneNode): NodeFontReadiness {
  let pending = false
  let exhausted = false
  for (const { family, style } of requiredNodeFontFaces(node)) {
    if (fontManager.isStyleLoaded(family, style)) continue
    const demand = fontFaceDemand(family, style, node.text)
    const state = fontResolver.state(demand).state
    demandFace(r, node, family, style)
    if (state === 'loaded' && fontManager.isLoaded(family)) continue
    if (state === 'failed' || state === 'exhausted') {
      // CanvasKit can synthesize a missing slant or weight from another loaded face in the same
      // family. Keep the text visible when an exact face (for example, Italic) is unavailable.
      if (fontManager.isLoaded(family)) continue
      exhausted = true
    } else {
      pending = true
    }
  }
  if (pending) return 'pending'
  if (exhausted && fontManager.isStyleLoaded(DEFAULT_FONT_FAMILY, 'Regular')) return 'substituted'
  return exhausted ? 'exhausted' : 'ready'
}

function demandRemoteCoverage(r: TextRenderer, node: SceneNode, characters: string[]): boolean {
  for (const { family, style } of requiredNodeFontFaces(node)) {
    if (!fontManager.remoteStyleNeedsCoverage(family, style, characters)) continue
    const demand = fontRemoteCoverageDemand(family, style, characters)
    const state = fontResolver.state(demand).state
    if (state === 'idle') {
      r.trackFontDemand?.(node, demand.key)
      void fontResolver.demandForNode(demand, node.id, r.onFontResolutionSettled)
      return true
    }
    if (state === 'loading') return true
    if (state === 'loaded') fontResolver.exhaust(demand)
  }
  return false
}

function missingCharactersByScript(r: TextRenderer, node: SceneNode) {
  if (
    r.fontProvider &&
    r.textPreparationCache?.hasGlyphCoverage(node, fontManager.generation(), r.fontProvider)
  ) {
    return { missingCount: 0, byScript: missingGlyphsByScript([], () => null) }
  }

  const missingOccurrences = withPreparedText(
    r,
    node,
    'coverage',
    () => buildParagraph(r, node),
    (prepared) => {
      if (!prepared.missingGlyphs) {
        prepared.paragraph.layout(resolveParagraphLayoutWidth(node))
        prepared.missingGlyphs = missingGlyphOccurrences(
          transformTextCase(node.text, node.textCase),
          prepared.paragraph.getShapedLines(),
          transformedSourceOffsets(node)
        )
      }
      return prepared.missingGlyphs
    }
  )
  if (missingOccurrences.length === 0) {
    r.textPreparationCache?.recordGlyphCoverage(node)
  }
  const charactersByScript = missingGlyphsByScript(missingOccurrences, (offset) =>
    languageForCharacter(node, offset)
  )
  return { missingCount: missingOccurrences.length, byScript: charactersByScript }
}

function observedGlyphReadiness(r: TextRenderer, node: SceneNode): NodeFontReadiness {
  const missing = missingCharactersByScript(r, node)
  if (missing.byScript.size === 0) return missing.missingCount > 0 ? 'exhausted' : 'ready'

  let pending = false
  let exhausted = false
  for (const [script, characters] of missing.byScript) {
    if (demandRemoteCoverage(r, node, characters)) {
      pending = true
      continue
    }

    const demand = fontCoverageDemand(script, characters)
    const state = fontResolver.state(demand).state
    if (state === 'loaded') {
      fontResolver.exhaust(demand)
      exhausted = true
      continue
    }
    if (state === 'exhausted' || state === 'failed') {
      exhausted = true
      continue
    }
    pending = true
    if (state === 'idle') {
      r.trackFontDemand?.(node, demand.key)
      void fontResolver.demandForNode(demand, node.id, r.onFontResolutionSettled)
    }
  }
  if (pending) return 'pending'
  return exhausted ? 'exhausted' : 'ready'
}

export function canObserveFontReadiness(r: FontReadinessRenderer): r is TextRenderer {
  return r.ck !== undefined && r.fontProvider != null && r.fontsLoaded === true
}

function restartFontDemand(
  r: FontReadinessRenderer,
  node: SceneNode,
  demand: FontResolutionDemand,
  clearFailure?: () => void
): string {
  if (fontResolver.state(demand).state !== 'loading') {
    clearFailure?.()
    fontResolver.reset(demand)
  }
  r.trackFontDemand?.(node, demand.key)
  void fontResolver.demandForNode(demand, node.id, r.onFontResolutionSettled)
  return demand.key
}

function clearFaceDemandFailures(demand: FontResolutionDemand): void {
  for (const candidate of demand.candidates) {
    if (candidate.source !== 'remote') continue
    fontManager.clearFontLoadFailure(
      candidate.family,
      candidate.style,
      fontCandidateCoverageText(demand, candidate)
    )
  }
}

export interface NodeFontRetryRequest {
  requested: boolean
  demandKeys: string[]
}

/**
 * Restart every unresolved face and glyph-coverage demand observable from the
 * live paragraph shaper. Fallback families stay encapsulated in FontManager;
 * callers receive demand keys only and never guess which family CanvasKit may
 * eventually use for an individual glyph.
 */
export function retryNodeFontReadiness(
  r: FontReadinessRenderer,
  node: SceneNode
): NodeFontRetryRequest {
  if (node.type !== 'TEXT') return { requested: false, demandKeys: [] }
  const demands = new Map<string, { demand: FontResolutionDemand; clearFailure?: () => void }>()

  for (const { family, style } of requiredNodeFontFaces(node)) {
    if (fontManager.isStyleLoaded(family, style)) continue
    const demand = fontFaceDemand(family, style, node.text)
    demands.set(demand.key, {
      demand,
      clearFailure: () => clearFaceDemandFailures(demand)
    })
  }

  if (node.text && canObserveFontReadiness(r)) {
    for (const [script, characters] of missingCharactersByScript(r, node).byScript) {
      const coverageText = characters.join('')
      for (const { family, style } of requiredNodeFontFaces(node)) {
        if (!fontManager.remoteStyleNeedsCoverage(family, style, characters)) continue
        const demand = fontRemoteCoverageDemand(family, style, characters)
        demands.set(demand.key, {
          demand,
          clearFailure: () => fontManager.clearFontLoadFailure(family, style, coverageText)
        })
      }
      const demand = fontCoverageDemand(script, characters)
      demands.set(demand.key, {
        demand,
        clearFailure: () => fontManager.clearFallbackLoadFailures(script, coverageText)
      })
    }
  }

  const demandKeys = [...demands.values()].map(({ demand, clearFailure }) =>
    restartFontDemand(r, node, demand, clearFailure)
  )
  return { requested: demandKeys.length > 0, demandKeys }
}

export function nodeFontReadiness(r: FontReadinessRenderer, node: SceneNode): NodeFontReadiness {
  if (node.type !== 'TEXT') return 'ready'
  const faces = requiredFacesReadiness(r, node)
  if (faces !== 'ready') return faces
  if (!node.text || !canObserveFontReadiness(r)) return 'ready'
  return observedGlyphReadiness(r, node)
}

export function isNodeFontLoaded(r: FontReadinessRenderer, node: SceneNode): boolean {
  const readiness = nodeFontReadiness(r, node)
  return readiness === 'ready' || readiness === 'substituted'
}

export function measureTextNode(
  r: TextRenderer,
  node: SceneNode,
  maxWidth?: number
): { width: number; height: number } | null {
  if (!r.fontsLoaded || !r.fontProvider || !isNodeFontLoaded(r, node)) return null
  if (node.type !== 'TEXT' || !node.text) return null

  const paragraph = buildParagraph(r, node)
  paragraph.layout(resolveParagraphLayoutWidth(node, maxWidth))
  const width = paragraph.getLongestLine()
  const height = paragraph.getHeight()
  paragraph.delete()
  return { width: Math.ceil(width), height: Math.ceil(height) }
}

export function buildTextPicture(r: TextRenderer, node: SceneNode): Uint8Array | null {
  if (!r.fontsLoaded || !r.fontProvider || !isNodeFontLoaded(r, node)) return null
  if (node.type !== 'TEXT' || !node.text) return null

  const ck = r.ck
  const recorder = new ck.PictureRecorder()
  const bounds = ck.LTRBRect(0, 0, node.width || 1e6, node.height || 1e6)
  const recCanvas = recorder.beginRecording(bounds)

  const paragraph = buildParagraph(r, node)
  recCanvas.drawParagraph(paragraph, 0, 0)
  paragraph.delete()

  const picture = recorder.finishRecordingAsPicture()
  recorder.delete()

  const bytes = picture.serialize()
  picture.delete()
  return bytes ?? null
}

function resolveParagraphLayoutWidth(node: ParagraphNode, maxWidth?: number): number {
  if (maxWidth !== undefined) return maxWidth
  if (node.textAutoResize === 'WIDTH_AND_HEIGHT') return 1e6
  return node.width || 1e6
}

function buildTruncateOpts(
  node: ParagraphNode,
  baseFontSize: number
): { maxLines?: number; ellipsis?: string } {
  if (node.textTruncation !== 'ENDING') return {}

  const opts: { maxLines?: number; ellipsis: string } = { ellipsis: '…' }
  if (node.maxLines != null && node.maxLines > 0) {
    opts.maxLines = node.maxLines
  } else if (node.height > 0) {
    const lineH = node.lineHeight || baseFontSize * 1.2
    opts.maxLines = Math.max(1, Math.floor(node.height / lineH))
  }
  return opts
}

function getParagraphTextAlign(
  ck: CanvasKit,
  node: Pick<SceneNode, 'textAlignHorizontal' | 'textDirection' | 'text'>
) {
  const direction = resolveNodeTextDirection(node)
  switch (node.textAlignHorizontal) {
    case 'CENTER':
      return ck.TextAlign.Center
    case 'RIGHT':
      return direction === 'RTL' ? ck.TextAlign.Left : ck.TextAlign.Right
    case 'JUSTIFIED':
      return ck.TextAlign.Justify
    default:
      return direction === 'RTL' ? ck.TextAlign.Right : ck.TextAlign.Left
  }
}

export function textFontVariations(
  variations: SceneNode['fontVariations'] | undefined
): TextFontVariations[] | undefined {
  if (!variations || variations.length === 0) return undefined
  return variations.map((variation) => ({ axis: variation.axis, value: variation.value }))
}

export function textFontFeatures(
  features: SceneNode['fontFeatures'] | undefined
): TextFontFeatures[] | undefined {
  if (!features || features.length === 0) return undefined
  return features.map((feature) => ({
    name: feature.tag.toLowerCase(),
    value: feature.enabled ? 1 : 0
  }))
}

function textDecorationValue(ck: CanvasKit, decoration: string): number {
  switch (decoration) {
    case 'UNDERLINE':
      return ck.UnderlineDecoration
    case 'STRIKETHROUGH':
      return ck.LineThroughDecoration
    default:
      return ck.NoDecoration
  }
}

export function textDecorationStyleValue<T>(
  ck: { DecorationStyle: { Solid: T; Dotted: T; Wavy: T } },
  style: SceneNode['textDecorationStyle'] | undefined
): T {
  switch (style) {
    case 'DOTTED':
      return ck.DecorationStyle.Dotted
    case 'WAVY':
      return ck.DecorationStyle.Wavy
    default:
      return ck.DecorationStyle.Solid
  }
}

export function textHeightBehaviorValue<T>(
  ck: { TextHeightBehavior: { DisableAll: T } },
  leadingTrim: SceneNode['leadingTrim']
): T | undefined {
  return leadingTrim === 'CAP_HEIGHT' ? ck.TextHeightBehavior.DisableAll : undefined
}

function textDecorationColor(
  ck: CanvasKit,
  fills: SceneNode['textDecorationFills'] | undefined,
  fallback: Float32Array
): Float32Array {
  const fill = firstVisibleSolidTextFill(fills)
  if (!fill) return fallback
  const color = resolveRGBAForPreview(fill.color).color
  return ck.Color4f(color.r, color.g, color.b, color.a * fill.opacity)
}

function styleRunColor(
  ck: CanvasKit,
  style: SceneNode['styleRuns'][number]['style'],
  baseColor: Float32Array
): Float32Array {
  const visibleFill = firstVisibleSolidTextFill(style.fills)
  if (!visibleFill) return baseColor
  const color = resolveRGBAForPreview(visibleFill.color).color
  return ck.Color4f(color.r, color.g, color.b, color.a * visibleFill.opacity)
}

function styleRunLanguage(
  style: SceneNode['styleRuns'][number]['style'],
  node: Pick<ParagraphNode, 'textLanguage'>
): string | undefined {
  return style.textLanguage ?? node.textLanguage ?? undefined
}

function pushStyleRun(
  r: TextRenderer,
  builder: ReturnType<CanvasKit['ParagraphBuilder']['MakeFromFontProvider']>,
  node: ParagraphNode,
  run: SceneNode['styleRuns'][number],
  baseColor: Float32Array,
  baseFontSize: number,
  fontFamilies: (primary: string, weight: number, italic?: boolean) => string[],
  halfLeading: boolean,
  paintStyle?: ParagraphPaintStyle
): void {
  const ck = r.ck
  const style = run.style
  const runLineHeight = style.lineHeight !== undefined ? style.lineHeight : node.lineHeight
  const runFontSize = style.fontSize ?? baseFontSize

  const textStyle = new ck.TextStyle({
    color: styleRunColor(ck, style, baseColor),
    fontFamilies: fontFamilies(
      style.fontFamily ?? (node.fontFamily || DEFAULT_FONT_FAMILY),
      style.fontWeight ?? node.fontWeight,
      style.italic ?? node.italic
    ),
    fontSize: runFontSize,
    locale: styleRunLanguage(style, node),
    fontStyle: {
      weight: { value: style.fontWeight ?? node.fontWeight } as FontWeight,
      slant: (style.italic ?? node.italic) ? ck.FontSlant.Italic : ck.FontSlant.Upright
    },
    fontVariations: textFontVariations(style.fontVariations ?? node.fontVariations),
    fontFeatures: textFontFeatures(style.fontFeatures ?? node.fontFeatures),
    letterSpacing: style.letterSpacing ?? (node.letterSpacing || 0),
    decoration: textDecorationValue(ck, style.textDecoration ?? node.textDecoration),
    decorationStyle: textDecorationStyleValue(
      ck,
      style.textDecorationStyle ?? node.textDecorationStyle
    ),
    decorationThickness: style.textDecorationThickness ?? node.textDecorationThickness ?? undefined,
    decorationColor: textDecorationColor(
      ck,
      style.textDecorationFills ?? node.textDecorationFills,
      baseColor
    ),
    heightMultiplier: runLineHeight ? runLineHeight / runFontSize : undefined,
    halfLeading
  })
  pushParagraphStyle(builder, textStyle, paintStyle)
}

function addParagraphText(
  builder: ReturnType<CanvasKit['ParagraphBuilder']['MakeFromFontProvider']>,
  node: Pick<ParagraphNode, 'textCase'>,
  text: string
): void {
  builder.addText(transformTextCase(text, node.textCase))
}

function addStyledRuns(
  r: TextRenderer,
  builder: ReturnType<CanvasKit['ParagraphBuilder']['MakeFromFontProvider']>,
  node: ParagraphNode,
  baseColor: Float32Array,
  baseFontSize: number,
  fontFamilies: (primary: string, weight: number, italic?: boolean) => string[],
  halfLeading: boolean,
  paintStyle?: ParagraphPaintStyle
): void {
  const text = node.text
  let pos = 0

  for (const run of node.styleRuns) {
    if (pos < run.start) addParagraphText(builder, node, text.slice(pos, run.start))
    pushStyleRun(
      r,
      builder,
      node,
      run,
      baseColor,
      baseFontSize,
      fontFamilies,
      halfLeading,
      paintStyle
    )
    addParagraphText(builder, node, text.slice(run.start, run.start + run.length))
    builder.pop()
    pos = run.start + run.length
  }

  if (pos < text.length) addParagraphText(builder, node, text.slice(pos))
}

export function buildParagraph(
  r: TextRenderer,
  node: ParagraphNode,
  color?: Float32Array,
  { halfLeading = false, foregroundPaint }: ParagraphBuildOptions = {}
): Paragraph {
  const ck = r.ck
  const baseColor = color ?? ck.BLACK
  const baseFontSize = node.fontSize || DEFAULT_FONT_SIZE
  const cjkFallbacks = fontManager.getCJKFallbackFamilies()
  const arabicFallbacks = fontManager.getArabicFallbackFamilies()
  const textDirection = resolveNodeTextDirection(node)

  const truncateOpts = buildTruncateOpts(node, baseFontSize)

  const fontFamilies = (primary: string, weight: number, italic = false) =>
    resolveParagraphFontFamilies(
      primary,
      weightToStyle(weight, italic),
      arabicFallbacks,
      cjkFallbacks
    )

  const baseTextStyle = {
    color: baseColor,
    fontFamilies: fontFamilies(
      node.fontFamily || DEFAULT_FONT_FAMILY,
      node.fontWeight,
      node.italic
    ),
    fontSize: baseFontSize,
    locale: node.textLanguage ?? undefined,
    fontStyle: {
      weight: { value: node.fontWeight } as FontWeight,
      slant: node.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright
    },
    fontVariations: textFontVariations(node.fontVariations),
    fontFeatures: textFontFeatures(node.fontFeatures),
    letterSpacing: node.letterSpacing || 0,
    decoration: textDecorationValue(ck, node.textDecoration),
    decorationStyle: textDecorationStyleValue(ck, node.textDecorationStyle),
    decorationThickness: node.textDecorationThickness ?? undefined,
    decorationColor: textDecorationColor(ck, node.textDecorationFills, baseColor),
    heightMultiplier: node.lineHeight ? node.lineHeight / baseFontSize : undefined,
    halfLeading
  }
  const paraStyle = new ck.ParagraphStyle({
    textAlign: getParagraphTextAlign(ck, node),
    textDirection: textDirection === 'RTL' ? ck.TextDirection.RTL : ck.TextDirection.LTR,
    textHeightBehavior: textHeightBehaviorValue(ck, node.leadingTrim),
    ...truncateOpts,
    textStyle: baseTextStyle
  })

  if (!r.fontProvider) throw new Error('Font provider not initialized')
  const builder = ck.ParagraphBuilder.MakeFromFontProvider(paraStyle, r.fontProvider)

  let background: Paint | undefined
  try {
    let paintStyle: ParagraphPaintStyle | undefined
    if (foregroundPaint) {
      background = new ck.Paint()
      background.setColor(ck.TRANSPARENT)
      paintStyle = { foreground: foregroundPaint, background }
      builder.pushPaintStyle(new ck.TextStyle(baseTextStyle), foregroundPaint, background)
    }
    if (node.styleRuns.length === 0) {
      addParagraphText(builder, node, node.text)
    } else {
      addStyledRuns(
        r,
        builder,
        node,
        baseColor,
        baseFontSize,
        fontFamilies,
        halfLeading,
        paintStyle
      )
    }

    const paragraph = builder.build()
    try {
      if (node.textAutoResize === 'WIDTH_AND_HEIGHT') {
        paragraph.layout(1e6)
        paragraph.layout(Math.max(node.width || 1, Math.ceil(paragraph.getLongestLine())))
      } else {
        paragraph.layout(resolveParagraphLayoutWidth(node))
      }
      return paragraph
    } catch (error) {
      paragraph.delete()
      throw error
    }
  } finally {
    builder.delete()
    background?.delete()
  }
}
