import {
  contentShader,
  withoutContentShader,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas'
import type { EditorContext } from '#core/editor/types'
import { renderNodesToImage } from '#core/io/formats/raster'
import { extractExportGraph } from '#core/io/subgraph'
import { fontManager } from '#core/text/fonts'
import { collectGraphFontRequirements } from '#core/text/requirements'
import { missingGraphFontScripts } from '#core/text/resolved-requirements'

/** Reuse the export compositor on a private, node-local copy, never a live shader image. */
export function renderShaderContent(
  graph: SceneGraph,
  node: SceneNode,
  renderer: SkiaRenderer
): Uint8Array | null {
  if (!contentShader(graph, node) || node.width <= 0 || node.height <= 0) return null
  const { graph: copy, pageId } = extractExportGraph(graph, { scope: 'node', nodeId: node.id })
  if (!pageId) return null
  const page = copy.getNode(pageId)
  if (!page) return null
  const source = withoutContentShader(node)
  copy.nodes.set(node.id, {
    ...source,
    parentId: pageId,
    x: 0,
    y: 0,
    rotation: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
    blendMode: 'NORMAL'
  })
  page.childIds = [node.id]
  copy.clearAbsPosCache()
  // The raster exporter supersamples at 2×; cap the input at 1024² before that allocation.
  const scale = Math.min(2, 1024 / Math.max(node.width, node.height, 1))
  return renderNodesToImage(renderer.ck, renderer, copy, pageId, [node.id], {
    scale,
    format: 'PNG',
    bounds: { minX: 0, minY: 0, maxX: node.width, maxY: node.height }
  })
}

/** Resolve the same font requirements as page preparation before taking content pixels. */
export async function prepareShaderContent(
  ctx: EditorContext,
  node: SceneNode,
  signal: AbortSignal
): Promise<boolean> {
  const graph = ctx.graph
  const requirements = collectGraphFontRequirements(graph, [node.id])
  for (const [family, style] of fontManager.collectFontKeys(graph, [node.id])) {
    const face = await ctx.loadFont(family, style, requirements.characters, { signal })
    if (!face || signal.aborted || graph !== ctx.graph) return false
  }
  const scripts = missingGraphFontScripts(requirements)
  const fallbacks = await fontManager.ensureFallbackPack(scripts, requirements.characters, {
    signal
  })
  if (signal.aborted || graph !== ctx.graph || scripts.some((script) => !fallbacks[script]?.length))
    return false
  ctx.runLayoutForNode(node.id)
  return true
}
