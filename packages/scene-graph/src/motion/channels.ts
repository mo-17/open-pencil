import type { MotionKeyframe } from './types'

export interface MotionChannels {
  opacity: boolean
  translate: boolean
  scale: boolean
  rotate: boolean
  origin?: boolean
  width?: boolean
  height?: boolean
  cornerRadius?: boolean
  fillColor?: boolean
  strokeColor?: boolean
  strokeWidth?: boolean
  blur?: boolean
  shadow?: boolean
  path?: boolean
  trim?: boolean
  gap?: boolean
  rowGap?: boolean
  columnGap?: boolean
  padding?: boolean
  paints?: boolean
  gradientStops?: boolean
  effects?: boolean
  cornerRadii?: boolean
  textReveal?: boolean
  fontAxes?: boolean
  vectorMorph?: boolean
}

/** Report which bounded visual channels a keyframe sequence writes. */
export function getMotionChannels(keyframes: readonly MotionKeyframe[]): MotionChannels {
  const channels: MotionChannels = {
    opacity: keyframes.some((frame) => frame.opacity !== undefined),
    translate: keyframes.some((frame) => frame.x !== undefined || frame.y !== undefined),
    scale: keyframes.some((frame) => frame.scaleX !== undefined || frame.scaleY !== undefined),
    rotate: keyframes.some((frame) => frame.rotate !== undefined)
  }
  const optional = {
    origin: keyframes.some((frame) => frame.originX !== undefined || frame.originY !== undefined),
    width: keyframes.some((frame) => frame.width !== undefined),
    height: keyframes.some((frame) => frame.height !== undefined),
    cornerRadius: keyframes.some((frame) => frame.cornerRadius !== undefined),
    fillColor: keyframes.some((frame) => frame.fillColor !== undefined),
    strokeColor: keyframes.some((frame) => frame.strokeColor !== undefined),
    strokeWidth: keyframes.some((frame) => frame.strokeWidth !== undefined),
    blur: keyframes.some((frame) => frame.blur !== undefined),
    shadow: keyframes.some(
      (frame) =>
        frame.shadowX !== undefined ||
        frame.shadowY !== undefined ||
        frame.shadowBlur !== undefined ||
        frame.shadowSpread !== undefined ||
        frame.shadowColor !== undefined
    ),
    path: keyframes.some((frame) => frame.pathProgress !== undefined),
    trim: keyframes.some(
      (frame) =>
        frame.trimStart !== undefined ||
        frame.trimEnd !== undefined ||
        frame.trimOffset !== undefined
    ),
    gap: keyframes.some((frame) => frame.gap !== undefined),
    rowGap: keyframes.some((frame) => frame.rowGap !== undefined),
    columnGap: keyframes.some((frame) => frame.columnGap !== undefined),
    padding: keyframes.some(
      (frame) =>
        frame.paddingTop !== undefined ||
        frame.paddingRight !== undefined ||
        frame.paddingBottom !== undefined ||
        frame.paddingLeft !== undefined
    ),
    paints: keyframes.some((frame) => frame.paints !== undefined),
    gradientStops: keyframes.some((frame) => frame.gradientStops !== undefined),
    effects: keyframes.some((frame) => frame.effects !== undefined),
    cornerRadii: keyframes.some((frame) => frame.cornerRadii !== undefined),
    textReveal: keyframes.some((frame) => frame.textReveal !== undefined),
    fontAxes: keyframes.some((frame) => frame.fontAxes !== undefined),
    vectorMorph: keyframes.some((frame) => frame.vectorMorph !== undefined)
  } as const
  for (const [channel, active] of Object.entries(optional)) {
    if (active) channels[channel as keyof typeof optional] = true
  }
  return channels
}
