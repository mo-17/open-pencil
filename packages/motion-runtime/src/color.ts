import type { MotionColor } from '@open-pencil/scene-graph'

function colorChannel(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255)
}

/** Preserve the bounded CSS serialization historically used by the core color adapter. */
export function colorToCSS(color: MotionColor): string {
  const channels = `${colorChannel(color.r)}, ${colorChannel(color.g)}, ${colorChannel(color.b)}`
  if (color.a === 1) return `rgb(${channels})`
  const alpha = Math.round(Math.min(1, Math.max(0, color.a)) * 100) / 100
  return `rgba(${channels}, ${alpha})`
}
