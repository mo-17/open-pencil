import type { PluginDataEntry, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { OutlineCommand } from './path-commands'

export interface FigGlyphOutlineMetric {
  commands: OutlineCommand[]
  x: number
  advance: number
}

export interface FigFontVerticalMetrics {
  /** Positive distance above the baseline, in pixels. */
  ascent: number
  /** Positive distance below the baseline, in pixels. */
  descent: number
  /** Natural font height (`ascent + descent`), in pixels. */
  naturalLineHeight: number
}

export interface FigNodeChangeExportRuntime {
  getGlyphOutlineMetrics(
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
  getGlyphOutlineMetrics: () => null
}
