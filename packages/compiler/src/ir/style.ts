import {
  collectLayoutPrimitiveClasses,
  collectResponsiveTailwindClasses,
  collectStateTailwindClasses,
  collectTailwindClasses
} from '@open-pencil/core/io/formats/jsx'
import type { SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

/**
 * Phase 3 §3.v5 — full SWITCH CSS (supersedes the §3.v4 step 9/9b hotfix).
 *
 * Track: `appearance-none` strips the native checkbox glyph; the input is a
 * query container (`container-type:size`) so the thumb pseudo-element can size
 * and travel in `cqw`/`cqh` — i.e. relative to the track's own width/height.
 * Colors are fixed (off gray / on blue, both with a dark variant) and override
 * any SceneNode fill — a created SWITCH already carries a default gray fill, so
 * deriving the on-color from it would just paint the toggle gray-on-gray.
 */
const SWITCH_TRACK = [
  'appearance-none',
  'cursor-pointer',
  'relative',
  'rounded-full',
  '[container-type:size]',
  'bg-gray-300',
  'dark:bg-gray-600',
  'checked:bg-blue-500',
  'dark:checked:bg-blue-400',
  'transition-colors'
]

/**
 * Thumb via the ::before pseudo-element. Square, 80% of the track height,
 * inset 10cqh on every side in the off state. Checked translates it by
 * `100cqw - 100cqh` (track width minus track height) so it lands with a
 * symmetric 10cqh gap on the right for ANY aspect ratio — and because it's a
 * `translate-x`, it tweens smoothly (the §3.v4 left↔right anchor swap couldn't
 * animate, CSS can't tween to/from `auto`).
 */
const SWITCH_THUMB = [
  "before:content-['']",
  'before:absolute',
  'before:top-[10cqh]',
  'before:left-[10cqh]',
  'before:h-[80cqh]',
  'before:aspect-square',
  'before:rounded-full',
  'before:bg-white',
  'dark:before:bg-gray-100',
  'before:shadow',
  'before:transition-transform',
  'before:duration-200',
  'before:ease-in-out',
  'checked:before:translate-x-[calc(100cqw_-_100cqh)]'
]

const SWITCH_CLASSES = [...SWITCH_TRACK, ...SWITCH_THUMB].join(' ')

/**
 * Derive the Tailwind class string for a SceneNode. Delegates to the core
 * JSX exporter so the design canvas and the compiled output stay in sync —
 * one source of truth for SceneNode → Tailwind translation. SWITCH appends
 * the toggle-specific styling above; §7 responsive overrides append the
 * breakpoint-prefixed diff classes after that.
 */
export function tailwindClassName(node: SceneNode, graph: SceneGraph): string {
  const base = collectTailwindClasses(node, graph).join(' ')
  const styled =
    node.type === 'SWITCH' ? (base === '' ? SWITCH_CLASSES : `${base} ${SWITCH_CLASSES}`) : base
  // §7 responsive overrides re-derive a breakpoint-prefixed diff in core (same
  // SceneNode → Tailwind translation), appended after the base/SWITCH styling.
  const responsive = collectResponsiveTailwindClasses(node, graph).join(' ')
  let combined = styled
  if (responsive !== '') combined = styled === '' ? responsive : `${styled} ${responsive}`
  // §20 interaction states re-derive a pseudo-class-prefixed diff in core (same
  // SceneNode → Tailwind translation), appended after the base/responsive styling.
  const states = collectStateTailwindClasses(node, graph).join(' ')
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
  if (!node.visible) return combined === '' ? 'hidden' : `${combined} hidden`
  return combined
}
