import {
  cloneGeneratedEffectSpec,
  parseGeneratedEffectSpec,
  type GeneratedEffectBlendMode,
  type GeneratedEffectSpecV1,
  type MotionColor,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

export interface GeneratedEffectRectPrimitive {
  kind: 'rect'
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  color: MotionColor
  opacity: number
}

export interface GeneratedEffectCirclePrimitive {
  kind: 'circle'
  x: number
  y: number
  radius: number
  color: MotionColor
  opacity: number
}

export type GeneratedEffectPrimitive = GeneratedEffectRectPrimitive | GeneratedEffectCirclePrimitive

export interface GeneratedEffectSample {
  status: 'active' | 'static' | 'disabled' | 'invalid'
  effectiveTimeMs: number
  blendMode: GeneratedEffectBlendMode
  opacity: number
  maxRasterPixels: number
  primitives: readonly GeneratedEffectPrimitive[]
}

export interface GeneratedEffectSampleOptions {
  prefersReducedMotion?: boolean
  /** Set false when a platform cannot draw the preset. Uses the authored static fallback. */
  supported?: boolean
}

/** Canonical authored mutation, including the explicit INSTANCE override/tombstone. */
export function generatedEffectNodeChanges(
  node: SceneNode,
  spec: GeneratedEffectSpecV1 | undefined
): Partial<SceneNode> {
  const authored = spec ? cloneGeneratedEffectSpec(spec) : undefined
  if (node.type !== 'INSTANCE') return { generatedEffect: authored }
  return {
    generatedEffect: authored,
    overrides: {
      ...node.overrides,
      generatedEffect: authored ? cloneGeneratedEffectSpec(authored) : null
    }
  }
}

const EMPTY_SAMPLE: GeneratedEffectSample = Object.freeze({
  status: 'invalid',
  effectiveTimeMs: 0,
  blendMode: 'normal',
  opacity: 0,
  maxRasterPixels: 1,
  primitives: Object.freeze([])
})

function fract(value: number): number {
  return value - Math.floor(value)
}

/** Stable uint32 avalanche; all runtimes use this exact integer operation order. */
export function generatedEffectHash(seed: number, index: number, frame: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e37_79b1) ^ Math.imul(frame + 1, 0x85eb_ca6b)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x7feb_352d) >>> 0
  value ^= value >>> 15
  value = Math.imul(value, 0x846c_a68b) >>> 0
  value ^= value >>> 16
  return value >>> 0
}

function random01(seed: number, index: number, frame: number): number {
  return generatedEffectHash(seed, index, frame) / 0x1_0000_0000
}

function resolvedTime(
  spec: GeneratedEffectSpecV1,
  timeMs: number,
  options: GeneratedEffectSampleOptions
): { status: GeneratedEffectSample['status']; timeMs: number } | null {
  if (options.prefersReducedMotion) {
    return spec.reducedMotion.mode === 'disable'
      ? null
      : { status: 'static', timeMs: spec.reducedMotion.timeMs }
  }
  if (options.supported === false) {
    return spec.fallback.kind === 'none' ? null : { status: 'static', timeMs: spec.fallback.timeMs }
  }
  return {
    status: 'active',
    timeMs: timeMs * spec.uniforms.time.scale + spec.uniforms.time.offsetMs
  }
}

function sampleNoise(
  spec: GeneratedEffectSpecV1,
  effectiveTimeMs: number
): GeneratedEffectPrimitive[] {
  if (spec.params.preset !== 'noise') return []
  const { cells, intensity, tint } = spec.params
  const frequency = spec.uniforms.time.frequencyHz
  const frame = frequency === 0 ? 0 : Math.floor((effectiveTimeMs / 1000) * frequency)
  const columns = Math.ceil(Math.sqrt(cells))
  const rows = Math.ceil(cells / columns)
  const primitives: GeneratedEffectPrimitive[] = []
  for (let index = 0; index < cells; index++) {
    const column = index % columns
    const row = Math.floor(index / columns)
    primitives.push({
      kind: 'rect',
      x: column / columns,
      y: row / rows,
      width: 1 / columns,
      height: 1 / rows,
      color: { ...tint },
      opacity: random01(spec.uniforms.seed, index, frame) * intensity
    })
  }
  return primitives
}

function effectPhase(spec: GeneratedEffectSpecV1, effectiveTimeMs: number): number {
  const frequency = spec.uniforms.time.frequencyHz
  return frequency === 0 ? 0 : fract((effectiveTimeMs / 1000) * frequency)
}

function sampleShimmer(
  spec: GeneratedEffectSpecV1,
  effectiveTimeMs: number
): GeneratedEffectPrimitive[] {
  if (spec.params.preset !== 'shimmer') return []
  const { bands, width, angle, color } = spec.params
  const phase = effectPhase(spec, effectiveTimeMs)
  const primitives: GeneratedEffectPrimitive[] = []
  for (let index = 0; index < bands; index++) {
    const distance = Math.abs((index + 0.5) / bands - 0.5)
    primitives.push({
      kind: 'rect',
      x: -width + phase * (1 + width * 2) + (index / bands - 0.5) * width,
      y: -0.5,
      width: width / bands,
      height: 2,
      rotation: angle,
      color: { ...color },
      opacity: Math.max(0, 1 - distance * 2)
    })
  }
  return primitives
}

function sampleScanlines(
  spec: GeneratedEffectSpecV1,
  effectiveTimeMs: number
): GeneratedEffectPrimitive[] {
  if (spec.params.preset !== 'scanlines') return []
  const { lines, thickness, color } = spec.params
  const phase = effectPhase(spec, effectiveTimeMs)
  const spacing = 1 / lines
  return Array.from(
    { length: lines },
    (_, index): GeneratedEffectPrimitive => ({
      kind: 'rect',
      x: 0,
      y: fract(index * spacing + phase * spacing),
      width: 1,
      height: Math.min(spacing, spacing * thickness),
      color: { ...color },
      opacity: 1
    })
  )
}

function sampleParticles(
  spec: GeneratedEffectSpecV1,
  effectiveTimeMs: number
): GeneratedEffectPrimitive[] {
  if (spec.params.preset !== 'particles') return []
  const { count, size, drift, color } = spec.params
  const phase = effectPhase(spec, effectiveTimeMs)
  return Array.from({ length: count }, (_, index): GeneratedEffectPrimitive => {
    const baseX = random01(spec.uniforms.seed, index * 3, 0)
    const baseY = random01(spec.uniforms.seed, index * 3 + 1, 0)
    const speed = 0.35 + random01(spec.uniforms.seed, index * 3 + 2, 0) * 0.65
    const progress = phase * speed
    return {
      kind: 'circle',
      x: fract(baseX + progress * drift),
      y: fract(baseY - progress),
      radius: size * (0.5 + speed * 0.5),
      color: { ...color },
      opacity: 0.35 + speed * 0.65
    }
  })
}

function samplePrimitives(
  spec: GeneratedEffectSpecV1,
  effectiveTimeMs: number
): GeneratedEffectPrimitive[] {
  switch (spec.params.preset) {
    case 'noise':
      return sampleNoise(spec, effectiveTimeMs)
    case 'shimmer':
      return sampleShimmer(spec, effectiveTimeMs)
    case 'scanlines':
      return sampleScanlines(spec, effectiveTimeMs)
    case 'particles':
      return sampleParticles(spec, effectiveTimeMs)
  }

  return []
}

/** Pure deterministic preset sampler shared by live CanvasKit and fixed-frame export. */
export function sampleGeneratedEffect(
  value: unknown,
  timeMs: number,
  options: GeneratedEffectSampleOptions = {}
): GeneratedEffectSample {
  let spec: GeneratedEffectSpecV1
  try {
    spec = parseGeneratedEffectSpec(value)
  } catch {
    return EMPTY_SAMPLE
  }
  const time = resolvedTime(spec, Number.isFinite(timeMs) ? timeMs : 0, options)
  if (!time) {
    return {
      status: 'disabled',
      effectiveTimeMs: 0,
      blendMode: spec.blendMode,
      opacity: 0,
      maxRasterPixels: spec.budget.maxRasterPixels,
      primitives: []
    }
  }
  const primitives = samplePrimitives(spec, time.timeMs).slice(0, spec.budget.maxPrimitives)
  return {
    status: time.status,
    effectiveTimeMs: time.timeMs,
    blendMode: spec.blendMode,
    opacity: spec.opacity,
    maxRasterPixels: spec.budget.maxRasterPixels,
    primitives
  }
}

export interface GraphGeneratedEffectActivityOptions {
  /** Restrict activity to one rendered page. Omit only for format-neutral whole-graph inspection. */
  pageId?: string
  prefersReducedMotion?: boolean
}

/** Page-scoped runtime gate used by the editor render loop; malformed and invisible data stays inert. */
export function graphHasAnimatedGeneratedEffects(
  graph: SceneGraph,
  options: GraphGeneratedEffectActivityOptions = {}
): boolean {
  if (options.prefersReducedMotion) return false
  const roots = options.pageId
    ? [graph.getNode(options.pageId)].filter((node): node is SceneNode => node !== undefined)
    : graph.getPages()
  const pending = [...roots]
  while (pending.length > 0) {
    const node = pending.pop()
    if (!node || !node.visible || node.internalOnly || node.isMask || node.opacity <= 0) continue
    for (let index = node.childIds.length - 1; index >= 0; index--) {
      const child = graph.getNode(node.childIds[index])
      if (child) pending.push(child)
    }
    const value = node.generatedEffect
    if (!value) continue
    if (!(node.width > 0 && node.height > 0)) continue
    let spec: GeneratedEffectSpecV1
    try {
      spec = parseGeneratedEffectSpec(value)
    } catch {
      continue
    }
    if (spec.opacity > 0 && spec.uniforms.time.scale > 0 && spec.uniforms.time.frequencyHz > 0) {
      return true
    }
  }
  return false
}
