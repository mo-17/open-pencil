import { collectTailwindClasses } from '@open-pencil/core/io/formats/jsx'
import type { SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

/**
 * Derive the Tailwind class string for a SceneNode. Delegates to the core
 * JSX exporter so the design canvas and the compiled output stay in sync —
 * one source of truth for SceneNode → Tailwind translation.
 *
 * Phase 3 §3.v4 step 9 — appends SWITCH-specific styling so a `role="switch"`
 * checkbox renders as a sliding toggle (track + thumb) instead of the native
 * checkbox glyph. Uses percentage positioning + aspect-square so it scales
 * with the SceneNode's bbox; background colors override any fill from the
 * SceneNode (acceptable for a control; users rarely customize SWITCH fill).
 * Full CSS spec lives at §13.
 */
const SWITCH_CLASSES = [
  // Strip the native checkbox glyph + treat the input as a styled box.
  'appearance-none',
  'cursor-pointer',
  'relative',
  'rounded-full',
  // Track color (off / checked).
  'bg-gray-300',
  'checked:bg-blue-500',
  'transition-colors',
  // Thumb via ::before pseudo-element — square, ~80% of track height,
  // anchored 5% from the LEFT edge in off state and 5% from the RIGHT
  // edge when checked (left-auto handoff). This gives true visual
  // symmetry across any aspect ratio — fixed-percentage anchors like
  // `left-[55%]` only line up for one specific track ratio. Animation
  // between left and right anchors is snappier than a translate-x
  // tween; full smooth-tween CSS goes to §13.
  "before:content-['']",
  'before:absolute',
  'before:inset-y-[10%]',
  'before:left-[5%]',
  'before:right-auto',
  'before:aspect-square',
  'before:rounded-full',
  'before:bg-white',
  'before:shadow',
  'before:transition-colors',
  'checked:before:left-auto',
  'checked:before:right-[5%]'
].join(' ')

export function tailwindClassName(node: SceneNode, graph: SceneGraph): string {
  const base = collectTailwindClasses(node, graph).join(' ')
  if (node.type === 'SWITCH') {
    return base === '' ? SWITCH_CLASSES : `${base} ${SWITCH_CLASSES}`
  }
  return base
}
