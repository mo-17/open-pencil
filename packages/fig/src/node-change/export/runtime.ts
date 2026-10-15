import type {
  DerivedTextGlyph,
  PluginDataEntry,
  SceneGraph,
  SceneNode
} from '@open-pencil/scene-graph'

import type { ShapedText } from '../derived-text/build'
import type { OutlineCommand } from '../path/commands'

/**
 * A glyph where it stands, as saved and shaped glyphs both give it, with its outline: saved
 * glyphs keep it as command bytes, shaped ones as commands, or none when unknown.
 */
export type PlacedTextGlyph = Pick<
  DerivedTextGlyph,
  'x' | 'y' | 'firstCharacter' | 'advance' | 'fontSize' | 'scaleX' | 'scaleY'
> & { commandsBlob?: Uint8Array; commands?: OutlineCommand[] | null }

/** One underline or strikethrough on one line, by the first character it decorates. */
export interface TextDecorationRecord {
  firstCharacter: number
  x: number
  y: number
  width: number
  height: number
}

export interface FigFontVerticalMetrics {
  /** Positive distance above the baseline, in pixels. */
  ascent: number
  /** Positive distance below the baseline, in pixels. */
  descent: number
  /** Natural font height (`ascent + descent`), in pixels. */
  naturalLineHeight: number
}

export interface FigGlyphOutlineMetric {
  commands: OutlineCommand[]
  x: number
  advance: number
}

/** Engine services the `.fig` writer needs but cannot provide without a text shaper. */
export interface FigNodeChangeExportRuntime {
  /** Lay the node's text out at its width as the renderer draws it, or `null` when it cannot. */
  shapeText?(node: SceneNode): ShapedText | null
  /** The node's underlines and strikethroughs over these glyphs, as Figma saves them. */
  textDecorations?(node: SceneNode, glyphs: readonly PlacedTextGlyph[]): TextDecorationRecord[]
  getGlyphOutlineMetrics?(
    family: string,
    style: string,
    text: string,
    fontSize: number
  ): FigGlyphOutlineMetric[] | null
  getFontVerticalMetrics?(
    family: string,
    style: string,
    fontSize: number
  ): FigFontVerticalMetrics | null
  getAdditionalPluginData?(node: SceneNode, graph: SceneGraph): PluginDataEntry[]
  /** Replace a node with an export-only projection without mutating the source graph. */
  getExportNode?(node: SceneNode, graph: SceneGraph): SceneNode
  /** Override the native Figma node type used for an exported scene node. */
  getExportNodeType?(node: SceneNode, defaultType: string, graph: SceneGraph): string
  /** Supply an export-only child projection without mutating the source graph. */
  getExportChildren?(node: SceneNode, graph: SceneGraph): readonly SceneNode[]
}

export const EMPTY_EXPORT_RUNTIME: FigNodeChangeExportRuntime = {
  shapeText: () => null,
  textDecorations: () => []
}
