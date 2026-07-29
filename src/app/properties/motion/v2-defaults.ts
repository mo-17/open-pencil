import { BLACK, type MotionColor, type SceneNode } from '@open-pencil/scene-graph'

import type { MotionV2ColorChannel, MotionV2NumericChannel } from './v2'

export function motionV2ColorDefault(
  node: SceneNode | undefined,
  channel: MotionV2ColorChannel
): MotionColor {
  if (channel === 'fillColor') {
    const fill = node?.fills.find((candidate) => candidate.visible && candidate.type === 'SOLID')
    return fill?.color ? { ...fill.color } : { ...BLACK }
  }
  if (channel === 'strokeColor') {
    const stroke = node?.strokes.find((candidate) => candidate.visible)
    return stroke?.color ? { ...stroke.color } : { ...BLACK }
  }
  const shadow = node?.effects.find((effect) => effect.visible && effect.type === 'DROP_SHADOW')
  return shadow?.color ? { ...shadow.color } : { ...BLACK, a: 0.25 }
}

interface MotionV2DefaultContext {
  node: SceneNode | undefined
  shadow: SceneNode['effects'][number] | undefined
  blur: SceneNode['effects'][number] | undefined
}

function rowGapDefault(node: SceneNode | undefined): number {
  if (node?.layoutMode === 'VERTICAL') return node.itemSpacing
  if (node?.layoutMode === 'HORIZONTAL') return node.counterAxisSpacing
  return node?.gridRowGap ?? 0
}

function columnGapDefault(node: SceneNode | undefined): number {
  if (node?.layoutMode === 'VERTICAL') return node.counterAxisSpacing
  if (node?.layoutMode === 'HORIZONTAL') return node.itemSpacing
  return node?.gridColumnGap ?? 0
}

const NUMERIC_DEFAULTS = {
  originX: () => 0.5,
  originY: () => 0.5,
  width: ({ node }) => node?.width ?? 0,
  height: ({ node }) => node?.height ?? 0,
  cornerRadius: ({ node }) => node?.cornerRadius ?? 0,
  strokeWidth: ({ node }) => node?.strokes.find((stroke) => stroke.visible)?.weight ?? 0,
  blur: ({ blur }) => blur?.radius ?? 0,
  shadowX: ({ shadow }) => shadow?.offset.x ?? 0,
  shadowY: ({ shadow }) => shadow?.offset.y ?? 0,
  shadowBlur: ({ shadow }) => shadow?.radius ?? 0,
  shadowSpread: ({ shadow }) => shadow?.spread ?? 0,
  trimStart: () => 0,
  trimEnd: () => 1,
  trimOffset: () => 0,
  gap: ({ node }) => node?.itemSpacing ?? 0,
  rowGap: ({ node }) => rowGapDefault(node),
  columnGap: ({ node }) => columnGapDefault(node),
  paddingTop: ({ node }) => node?.paddingTop ?? 0,
  paddingRight: ({ node }) => node?.paddingRight ?? 0,
  paddingBottom: ({ node }) => node?.paddingBottom ?? 0,
  paddingLeft: ({ node }) => node?.paddingLeft ?? 0
} satisfies Record<MotionV2NumericChannel, (context: MotionV2DefaultContext) => number>

export function motionV2NumericDefault(
  node: SceneNode | undefined,
  channel: MotionV2NumericChannel
): number {
  const shadow = node?.effects.find((effect) => effect.visible && effect.type === 'DROP_SHADOW')
  const blur = node?.effects.find(
    (effect) =>
      effect.visible && (effect.type === 'LAYER_BLUR' || effect.type === 'FOREGROUND_BLUR')
  )
  return NUMERIC_DEFAULTS[channel]({ node, shadow, blur })
}
