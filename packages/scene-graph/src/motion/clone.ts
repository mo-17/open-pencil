import type { MotionEasing, MotionKeyframe, MotionPath } from './types'

function cloneEasing(easing: MotionEasing | undefined): MotionEasing | undefined {
  return easing && typeof easing === 'object' ? { ...easing } : easing
}

/** Deep-copy one bounded keyframe including every structured v3 channel. */
export function cloneMotionKeyframe(keyframe: MotionKeyframe): MotionKeyframe {
  return {
    ...keyframe,
    ...(keyframe.fillColor ? { fillColor: { ...keyframe.fillColor } } : {}),
    ...(keyframe.strokeColor ? { strokeColor: { ...keyframe.strokeColor } } : {}),
    ...(keyframe.shadowColor ? { shadowColor: { ...keyframe.shadowColor } } : {}),
    ...(keyframe.paints
      ? {
          paints: keyframe.paints.map((paint) => ({
            ...paint,
            ...(paint.color ? { color: { ...paint.color } } : {})
          }))
        }
      : {}),
    ...(keyframe.gradientStops
      ? {
          gradientStops: keyframe.gradientStops.map((stop) => ({
            ...stop,
            color: { ...stop.color }
          }))
        }
      : {}),
    ...(keyframe.effects
      ? {
          effects: keyframe.effects.map((effect) => ({
            ...effect,
            ...(effect.kind === 'shadow' ? { color: { ...effect.color } } : {})
          }))
        }
      : {}),
    ...(keyframe.cornerRadii ? { cornerRadii: { ...keyframe.cornerRadii } } : {}),
    ...(keyframe.fontAxes ? { fontAxes: keyframe.fontAxes.map((axis) => ({ ...axis })) } : {}),
    ...(keyframe.vectorMorph
      ? {
          vectorMorph: {
            topologyId: keyframe.vectorMorph.topologyId,
            points: keyframe.vectorMorph.points.map((point) => ({ ...point }))
          }
        }
      : {}),
    ...(keyframe.easing ? { easing: cloneEasing(keyframe.easing) } : {})
  }
}

/** Deep-copy a Motion path so prepared/runtime representations never retain document references. */
export function cloneMotionPath(path: MotionPath): MotionPath {
  if (path.version === 2) {
    return {
      version: 2,
      start: { ...path.start },
      segments: path.segments.map((segment) => ({
        control1: { ...segment.control1 },
        control2: { ...segment.control2 },
        end: { ...segment.end }
      })),
      ...(path.autoRotate === undefined ? {} : { autoRotate: path.autoRotate })
    }
  }
  return {
    ...(path.version === undefined ? {} : { version: path.version }),
    points: path.points.map(({ x, y }) => ({ x, y })),
    ...(path.autoRotate === undefined ? {} : { autoRotate: path.autoRotate })
  }
}
