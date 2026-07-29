import type { MotionKeyframe, MotionSpec } from '@open-pencil/scene-graph'

function advancedFrame(offset: 0 | 1): MotionKeyframe {
  const start = offset === 0
  const color = start ? { r: 1, g: 0.2, b: 0, a: 1 } : { r: 0, g: 0.4, b: 1, a: 0.5 }

  return {
    id: start ? 'advanced-start' : 'advanced-end',
    offset,
    paints: [
      { kind: 'fill', index: 0, color, opacity: start ? 0.2 : 0.8 },
      { kind: 'stroke', index: 1, opacity: start ? 0.4 : 1 }
    ],
    gradientStops: [
      {
        kind: 'fill',
        paintIndex: 2,
        stopIndex: 0,
        position: start ? 0.1 : 0.4,
        color
      }
    ],
    effects: [
      { kind: 'blur', index: 0, radius: start ? 0 : 12 },
      {
        kind: 'shadow',
        index: 1,
        x: start ? 0 : 10,
        y: start ? 2 : 12,
        blur: start ? 4 : 20,
        spread: start ? 0 : 4,
        color
      }
    ],
    cornerRadii: {
      topLeft: start ? 0 : 10,
      topRight: start ? 2 : 12,
      bottomRight: start ? 4 : 14,
      bottomLeft: start ? 6 : 16
    },
    textReveal: offset,
    fontAxes: [
      { tag: 'wght', value: start ? 100 : 900 },
      { tag: 'wdth', value: start ? 50 : 100 }
    ],
    vectorMorph: {
      topologyId: 'glyph:triangle-v1',
      points: start
        ? [
            { x: 0, y: 0 },
            { x: 10, y: 10 }
          ]
        : [
            { x: 20, y: 10 },
            { x: 30, y: 50 }
          ]
    }
  }
}

/** Fresh, validator-safe fixture containing every MotionSpec v3 structured channel. */
export function advancedMotionSpec(): MotionSpec {
  return {
    version: 3,
    reducedMotion: 'reduce',
    preset: { id: 'advanced-visuals', version: 1, parameters: {} },
    tracks: [
      {
        id: 'advanced-visuals',
        name: 'Advanced visuals',
        trigger: 'mount',
        keyframes: [advancedFrame(0), advancedFrame(1)],
        timing: { durationMs: 1_000, easing: 'linear', fill: 'both' },
        composition: { mode: 'replace', weight: 1, priority: 4 }
      }
    ]
  }
}
