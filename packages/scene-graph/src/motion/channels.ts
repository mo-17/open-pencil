import type { MotionKeyframe } from './types'

export interface MotionChannels {
  opacity: boolean
  translate: boolean
  scale: boolean
  rotate: boolean
}

/** Report which bounded visual channels a keyframe sequence writes. */
export function getMotionChannels(keyframes: readonly MotionKeyframe[]): MotionChannels {
  return {
    opacity: keyframes.some((frame) => frame.opacity !== undefined),
    translate: keyframes.some((frame) => frame.x !== undefined || frame.y !== undefined),
    scale: keyframes.some((frame) => frame.scaleX !== undefined || frame.scaleY !== undefined),
    rotate: keyframes.some((frame) => frame.rotate !== undefined)
  }
}
