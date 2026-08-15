import type {
  GeneratedEffectParams,
  GeneratedEffectPreset,
  GeneratedEffectSpecV1
} from '@open-pencil/scene-graph'

const WHITE = { r: 1, g: 1, b: 1, a: 1 } as const

function paramsForPreset(preset: GeneratedEffectPreset): GeneratedEffectParams {
  switch (preset) {
    case 'noise':
      return { preset, cells: 16, intensity: 0.45, tint: { ...WHITE } }
    case 'shimmer':
      return { preset, bands: 3, width: 0.24, angle: 18, color: { ...WHITE } }
    case 'scanlines':
      return { preset, lines: 12, thickness: 0.25, color: { ...WHITE } }
    case 'particles':
      return { preset, count: 10, size: 0.04, drift: 0.2, color: { ...WHITE } }
  }
  throw new Error(`Unsupported generated-effect preset: ${preset}`)
}

export function generatedEffect(
  preset: GeneratedEffectPreset = 'particles'
): GeneratedEffectSpecV1 {
  return {
    version: 1,
    params: paramsForPreset(preset),
    uniforms: {
      time: { source: 'timeline', scale: 1, offsetMs: 0, frequencyHz: 6 },
      seed: 42
    },
    budget: { maxPrimitives: 64, maxRasterPixels: 65_536 },
    opacity: 0.7,
    blendMode: 'screen',
    reducedMotion: { mode: 'static', timeMs: 250 },
    fallback: { kind: 'static', timeMs: 125 }
  }
}

export function expectDefined<T>(value: T | null | undefined, label = 'value'): NonNullable<T> {
  if (value == null) throw new Error(`${label} was expected to be defined`)
  return value
}
