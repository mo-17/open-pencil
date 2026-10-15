import { compact } from 'es-toolkit'

import { LOWCODE_SWITCH_APPEARANCE } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

const appearance = LOWCODE_SWITCH_APPEARANCE
const diameter = `min(${appearance.thumbHeightRatio * 100}cqh,${appearance.thumbMaxWidthRatio * 100}cqw)`
const inset = `min(${appearance.thumbInsetRatio * 100}cqw,${appearance.thumbInsetRatio * 100}cqh)`
const travel = `calc(100cqw_-_2*${inset}_-_${diameter})`

/** A grid item lives in the input's content box, so authored padding and border
 * naturally reduce its query container. Neither the native nor the Radix root
 * needs relative positioning or a second thumb element. */
export const SWITCH_APPEARANCE_CLASSES = [
  'appearance-none',
  'box-border',
  'grid',
  'items-center',
  'justify-items-[left]',
  'cursor-pointer',
  'rounded-full',
  '[container-type:size]',
  `bg-[${appearance.trackOff}]`,
  `checked:bg-[${appearance.trackOn}]`,
  `data-[state=checked]:bg-[${appearance.trackOn}]`,
  'transition-colors',
  `duration-[${appearance.transitionMs}ms]`,
  'motion-reduce:transition-none',
  'focus-visible:outline-none',
  'focus-visible:ring-2',
  `focus-visible:ring-[${appearance.trackOn}]`,
  'focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed',
  "before:content-['']",
  'before:block',
  'before:pointer-events-none',
  `before:ml-[${inset}]`,
  `before:h-[${diameter}]`,
  'before:aspect-square',
  'before:rounded-full',
  `before:bg-[${appearance.thumb}]`,
  'before:transition-transform',
  `before:duration-[${appearance.transitionMs}ms]`,
  'before:ease-in-out',
  'motion-reduce:before:transition-none',
  `checked:before:translate-x-[${travel}]`,
  `data-[state=checked]:before:translate-x-[${travel}]`
].join(' ')

export const SWITCH_DISABLED_CLASS = `disabled:opacity-[${appearance.disabledOpacity}]`

/** Keep layout, authored effects and subsequent responsive/state variants.
 * The switch owns its base capsule and colors; competing base radii must not
 * depend on Tailwind's generated stylesheet ordering. */
export function switchClassName(baseClasses: readonly string[], node: SceneNode): string {
  const base = baseClasses.filter(
    (className) => !className.startsWith('bg-') && !className.startsWith('rounded')
  )
  // CSS opacity replaces the base value; Canvas applies its disabled multiplier
  // inside the node's opacity layer. Preserve that composition in the emitted value.
  const disabled =
    node.stateOverrides?.disabled?.opacity === undefined
      ? `disabled:opacity-[${node.opacity * appearance.disabledOpacity}]`
      : ''
  return compact([...base, SWITCH_APPEARANCE_CLASSES, disabled]).join(' ')
}
