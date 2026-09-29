import {
  collectLayoutPrimitiveClasses,
  collectResponsiveTailwindClasses,
  collectStateTailwindClasses,
  collectTailwindClasses,
  type TailwindClassOptions
} from '@open-pencil/core/io/formats/jsx'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { inputControlClassName } from './input-control-style'
import { selectClassName } from './select'
import { switchClassName } from './switch-style'

export interface CompilerStyleOptions {
  rtlLogicalProperties?: boolean
}

/**
 * The core JSX exporter renders LINE as a CSS bar: it replaces the authored
 * width/height with the diagonal length/stroke weight and rotates the wrapper.
 * The compiler, however, emits LINE geometry as an inline SVG. Applying that
 * CSS conversion as well rotates and distorts the SVG a second time (a 1x60
 * vertical line becomes a 60x2 wrapper containing a 1x60 viewBox).
 *
 * Treat LINE as a generic vector only while collecting compiler layout styles.
 * This keeps its authored bounds and rotation; the inline SVG remains the sole
 * owner of the line's endpoint geometry and stroke paint.
 */
function compilerStyleNode(node: SceneNode): SceneNode {
  return node.type === 'LINE' ? { ...node, type: 'VECTOR' } : node
}

function coreTailwindOptions(options: CompilerStyleOptions = {}): TailwindClassOptions {
  return { logicalProperties: options.rtlLogicalProperties === true }
}

/**
 * Derive the Tailwind class string for a SceneNode. Delegates to the core
 * JSX exporter so the design canvas and the compiled output stay in sync —
 * one source of truth for SceneNode → Tailwind translation. SWITCH projects
 * its shared control appearance; §7 responsive overrides append the
 * breakpoint-prefixed diff classes after that.
 */
export function tailwindClassName(
  node: SceneNode,
  graph: SceneGraph,
  options: CompilerStyleOptions = {}
): string {
  const tailwindOptions = coreTailwindOptions(options)
  const styleNode = compilerStyleNode(node)
  const baseClasses = collectTailwindClasses(styleNode, graph, tailwindOptions)
  const styled = controlClassName(baseClasses, node)
  // §7 responsive overrides re-derive a breakpoint-prefixed diff in core (same
  // SceneNode → Tailwind translation), appended after the base/SWITCH styling.
  const responsive = collectResponsiveTailwindClasses(styleNode, graph, tailwindOptions).join(' ')
  let combined = styled
  if (responsive !== '') combined = styled === '' ? responsive : `${styled} ${responsive}`
  // §20 interaction states re-derive a pseudo-class-prefixed diff in core (same
  // SceneNode → Tailwind translation), appended after the base/responsive styling.
  const states = collectStateTailwindClasses(styleNode, graph, tailwindOptions).join(' ')
  if (states !== '') combined = combined === '' ? states : `${combined} ${states}`
  // §26 layout primitives ride interactiveProps.layout and append after base /
  // responsive / state classes so author intent wins for positioning layers.
  const layoutPrimitives = collectLayoutPrimitiveClasses(node).join(' ')
  if (layoutPrimitives !== '') {
    combined = combined === '' ? layoutPrimitives : `${combined} ${layoutPrimitives}`
  }
  // §8 v7: a node hidden via an instance `:visible` override → `hidden`.
  // `collectTailwindClasses` ignores `visible` (it's structural, not style), and
  // base-hidden nodes are skipped before emit, so this only fires for an
  // invisible *instance child* (referenced through its component's className
  // prop) — making the previously-silent `:visible` override take effect.
  if (!node.visible) combined = combined === '' ? 'hidden' : `${combined} hidden`
  return inputControlClassName(combined, node)
}

function controlClassName(classes: string[], node: SceneNode): string {
  if (node.type === 'SWITCH') return switchClassName(classes, node)
  if (node.type === 'SELECT') return selectClassName(classes, node)
  return classes.join(' ')
}
