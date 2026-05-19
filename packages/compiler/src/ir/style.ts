import { collectTailwindClasses } from '@open-pencil/core/io/formats/jsx'
import type { SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

/**
 * Derive the Tailwind class string for a SceneNode. Delegates to the core
 * JSX exporter so the design canvas and the compiled output stay in sync —
 * one source of truth for SceneNode → Tailwind translation.
 */
export function tailwindClassName(node: SceneNode, graph: SceneGraph): string {
  return collectTailwindClasses(node, graph).join(' ')
}
