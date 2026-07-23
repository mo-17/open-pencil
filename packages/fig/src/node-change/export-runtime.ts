import type { PluginDataEntry, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { OutlineCommand } from './path-commands'

export interface FigGlyphOutlineMetric {
  commands: OutlineCommand[]
  x: number
  advance: number
}

export interface FigNodeChangeExportRuntime {
  getGlyphOutlineMetrics(
    family: string,
    style: string,
    text: string,
    fontSize: number
  ): FigGlyphOutlineMetric[] | null
  getAdditionalPluginData?(node: SceneNode, graph: SceneGraph): PluginDataEntry[]
}

export const EMPTY_EXPORT_RUNTIME: FigNodeChangeExportRuntime = {
  getGlyphOutlineMetrics: () => null
}
