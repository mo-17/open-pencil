/**
 * Self-contained Canvas2D fallback used by compiled apps. The generated source
 * accepts no shader/program text: it re-validates the bounded preset envelope,
 * uses an explicit timeline + uint32 seed, caps backing pixels/primitives, and
 * exposes renderAt() for deterministic preview/export verification.
 */
export function buildGeneratedEffectRuntime(): string {
  return `type EffectColor = { r: number; g: number; b: number; a: number }
type EffectParams =
  | { preset: 'noise'; cells: number; intensity: number; tint: EffectColor }
  | { preset: 'shimmer'; bands: number; width: number; angle: number; color: EffectColor }
  | { preset: 'scanlines'; lines: number; thickness: number; color: EffectColor }
  | { preset: 'particles'; count: number; size: number; drift: number; color: EffectColor }
type EffectSpec = {
  version: 1
  params: EffectParams
  uniforms: {
    time: { source: 'timeline'; scale: number; offsetMs: number; frequencyHz: number }
    seed: number
  }
  budget: { maxPrimitives: number; maxRasterPixels: number }
  opacity: number
  blendMode: 'normal' | 'screen' | 'multiply' | 'overlay'
  reducedMotion: { mode: 'disable' } | { mode: 'static'; timeMs: number }
  fallback: { kind: 'none' } | { kind: 'static'; timeMs: number }
}
type RectPrimitive = {
  kind: 'rect'
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  color: EffectColor
  opacity: number
}
type CirclePrimitive = {
  kind: 'circle'
  x: number
  y: number
  radius: number
  color: EffectColor
  opacity: number
}
type Primitive = RectPrimitive | CirclePrimitive
type EffectSample = {
  status: 'active' | 'static' | 'disabled'
  effectiveTimeMs: number
  blendMode: EffectSpec['blendMode']
  opacity: number
  maxRasterPixels: number
  primitives: Primitive[]
}
type RuntimeEntry = {
  host: HTMLElement
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  spec: EffectSpec
  inlinePosition: string
  changedPosition: boolean
}
type GeneratedEffectRuntime = {
  renderAt(timeMs: number): void
  refresh(): void
  dispose(): void
  inspect(): { activeLayerCount: number; nodeIds: string[] }
  sample(raw: string, timeMs: number, reduced?: boolean, supported?: boolean): EffectSample | null
}

declare global {
  interface Window {
    __OPENPENCIL_GENERATED_EFFECT_RUNTIME__?: GeneratedEffectRuntime
  }
}

const SELECTOR = '[data-op-generated-effect]'
const MAX_JSON_BYTES = 65536
const MAX_PRIMITIVES = 128
const MAX_RASTER_PIXELS = 262144
const MAX_FREQUENCY_HZ = 12
const MAX_TIME_MS = 120000
const entries = new Map<HTMLElement, RuntimeEntry>()
let observer: MutationObserver | null = null
let animationFrame: number | null = null
let disposed = false

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : null
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const parsed = record(value)
  if (!parsed) return null
  const actual = Object.keys(parsed)
  return actual.length === keys.length && actual.every((key) => keys.includes(key)) ? parsed : null
}

function numberIn(value: unknown, min: number, max: number, integer = false): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max &&
    (!integer || Number.isInteger(value))
    ? value
    : null
}

function effectColor(value: unknown): EffectColor | null {
  const parsed = exact(value, ['r', 'g', 'b', 'a'])
  if (!parsed) return null
  const r = numberIn(parsed.r, 0, 1)
  const g = numberIn(parsed.g, 0, 1)
  const b = numberIn(parsed.b, 0, 1)
  const a = numberIn(parsed.a, 0, 1)
  return r === null || g === null || b === null || a === null ? null : { r, g, b, a }
}

function effectParams(value: unknown): EffectParams | null {
  const parsed = record(value)
  if (!parsed || typeof parsed.preset !== 'string') return null
  const color = effectColor(parsed.color ?? parsed.tint)
  if (!color) return null
  if (parsed.preset === 'noise') {
    if (!exact(parsed, ['preset', 'cells', 'intensity', 'tint'])) return null
    const cells = numberIn(parsed.cells, 1, 96, true)
    const intensity = numberIn(parsed.intensity, 0, 1)
    return cells === null || intensity === null
      ? null
      : { preset: 'noise', cells, intensity, tint: color }
  }
  if (parsed.preset === 'shimmer') {
    if (!exact(parsed, ['preset', 'bands', 'width', 'angle', 'color'])) return null
    const bands = numberIn(parsed.bands, 1, 32, true)
    const width = numberIn(parsed.width, 0.01, 1)
    const angle = numberIn(parsed.angle, -180, 180)
    return bands === null || width === null || angle === null
      ? null
      : { preset: 'shimmer', bands, width, angle, color }
  }
  if (parsed.preset === 'scanlines') {
    if (!exact(parsed, ['preset', 'lines', 'thickness', 'color'])) return null
    const lines = numberIn(parsed.lines, 1, 64, true)
    const thickness = numberIn(parsed.thickness, 0.01, 1)
    return lines === null || thickness === null
      ? null
      : { preset: 'scanlines', lines, thickness, color }
  }
  if (parsed.preset !== 'particles') return null
  if (!exact(parsed, ['preset', 'count', 'size', 'drift', 'color'])) return null
  const count = numberIn(parsed.count, 1, 64, true)
  const size = numberIn(parsed.size, 0.002, 0.25)
  const drift = numberIn(parsed.drift, -2, 2)
  return count === null || size === null || drift === null
    ? null
    : { preset: 'particles', count, size, drift, color }
}

function primitiveCount(params: EffectParams): number {
  if (params.preset === 'noise') return params.cells
  if (params.preset === 'shimmer') return params.bands
  if (params.preset === 'scanlines') return params.lines
  return params.count
}

function decode(raw: string): EffectSpec | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_JSON_BYTES) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const root = exact(value, [
    'version', 'params', 'uniforms', 'budget', 'opacity', 'blendMode', 'reducedMotion', 'fallback'
  ])
  if (!root || root.version !== 1) return null
  const params = effectParams(root.params)
  const uniforms = exact(root.uniforms, ['time', 'seed'])
  const time = uniforms ? exact(uniforms.time, ['source', 'scale', 'offsetMs', 'frequencyHz']) : null
  const budget = exact(root.budget, ['maxPrimitives', 'maxRasterPixels'])
  const reduced = record(root.reducedMotion)
  const fallback = record(root.fallback)
  if (!params || !uniforms || !time || !budget || !reduced || !fallback) return null
  const scale = numberIn(time.scale, 0, 8)
  const offsetMs = numberIn(time.offsetMs, -MAX_TIME_MS, MAX_TIME_MS)
  const frequencyHz = numberIn(time.frequencyHz, 0, MAX_FREQUENCY_HZ)
  const seed = numberIn(uniforms.seed, 0, 4294967295, true)
  const maxPrimitives = numberIn(budget.maxPrimitives, 1, MAX_PRIMITIVES, true)
  const maxRasterPixels = numberIn(budget.maxRasterPixels, 1, MAX_RASTER_PIXELS, true)
  const opacity = numberIn(root.opacity, 0, 1)
  const blendModes = ['normal', 'screen', 'multiply', 'overlay']
  if (
    time.source !== 'timeline' || scale === null || offsetMs === null || frequencyHz === null ||
    seed === null || maxPrimitives === null || maxRasterPixels === null || opacity === null ||
    typeof root.blendMode !== 'string' || !blendModes.includes(root.blendMode) ||
    primitiveCount(params) > maxPrimitives
  ) return null
  let reducedMotion: EffectSpec['reducedMotion']
  if (reduced.mode === 'disable' && exact(reduced, ['mode'])) reducedMotion = { mode: 'disable' }
  else if (reduced.mode === 'static' && exact(reduced, ['mode', 'timeMs'])) {
    const timeMs = numberIn(reduced.timeMs, 0, MAX_TIME_MS)
    if (timeMs === null) return null
    reducedMotion = { mode: 'static', timeMs }
  } else return null
  let safeFallback: EffectSpec['fallback']
  if (fallback.kind === 'none' && exact(fallback, ['kind'])) safeFallback = { kind: 'none' }
  else if (fallback.kind === 'static' && exact(fallback, ['kind', 'timeMs'])) {
    const timeMs = numberIn(fallback.timeMs, 0, MAX_TIME_MS)
    if (timeMs === null) return null
    safeFallback = { kind: 'static', timeMs }
  } else return null
  return {
    version: 1,
    params,
    uniforms: { time: { source: 'timeline', scale, offsetMs, frequencyHz }, seed },
    budget: { maxPrimitives, maxRasterPixels },
    opacity,
    blendMode: root.blendMode as EffectSpec['blendMode'],
    reducedMotion,
    fallback: safeFallback
  }
}

function fract(value: number): number {
  return value - Math.floor(value)
}

function hash(seed: number, index: number, frame: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(frame + 1, 0x85ebca6b)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x7feb352d) >>> 0
  value ^= value >>> 15
  value = Math.imul(value, 0x846ca68b) >>> 0
  value ^= value >>> 16
  return value >>> 0
}

function random(seed: number, index: number, frame: number): number {
  return hash(seed, index, frame) / 4294967296
}

function phase(spec: EffectSpec, timeMs: number): number {
  const frequency = spec.uniforms.time.frequencyHz
  return frequency === 0 ? 0 : fract((timeMs / 1000) * frequency)
}

function noise(spec: EffectSpec, timeMs: number): Primitive[] {
  if (spec.params.preset !== 'noise') return []
  const params = spec.params
  const frequency = spec.uniforms.time.frequencyHz
  const frame = frequency === 0 ? 0 : Math.floor((timeMs / 1000) * frequency)
  const columns = Math.ceil(Math.sqrt(params.cells))
  const rows = Math.ceil(params.cells / columns)
  return Array.from({ length: params.cells }, (_, index): Primitive => ({
    kind: 'rect',
    x: (index % columns) / columns,
    y: Math.floor(index / columns) / rows,
    width: 1 / columns,
    height: 1 / rows,
    color: { ...params.tint },
    opacity: random(spec.uniforms.seed, index, frame) * params.intensity
  }))
}

function shimmer(spec: EffectSpec, timeMs: number): Primitive[] {
  if (spec.params.preset !== 'shimmer') return []
  const params = spec.params
  const progress = phase(spec, timeMs)
  return Array.from({ length: params.bands }, (_, index): Primitive => {
    const distance = Math.abs((index + 0.5) / params.bands - 0.5)
    return {
      kind: 'rect',
      x: -params.width + progress * (1 + params.width * 2) +
        (index / params.bands - 0.5) * params.width,
      y: -0.5,
      width: params.width / params.bands,
      height: 2,
      rotation: params.angle,
      color: { ...params.color },
      opacity: Math.max(0, 1 - distance * 2)
    }
  })
}

function scanlines(spec: EffectSpec, timeMs: number): Primitive[] {
  if (spec.params.preset !== 'scanlines') return []
  const params = spec.params
  const progress = phase(spec, timeMs)
  const spacing = 1 / params.lines
  return Array.from({ length: params.lines }, (_, index): Primitive => ({
    kind: 'rect',
    x: 0,
    y: fract(index * spacing + progress * spacing),
    width: 1,
    height: Math.min(spacing, spacing * params.thickness),
    color: { ...params.color },
    opacity: 1
  }))
}

function particles(spec: EffectSpec, timeMs: number): Primitive[] {
  if (spec.params.preset !== 'particles') return []
  const params = spec.params
  const progress = phase(spec, timeMs)
  return Array.from({ length: params.count }, (_, index): Primitive => {
    const baseX = random(spec.uniforms.seed, index * 3, 0)
    const baseY = random(spec.uniforms.seed, index * 3 + 1, 0)
    const speed = 0.35 + random(spec.uniforms.seed, index * 3 + 2, 0) * 0.65
    const distance = progress * speed
    return {
      kind: 'circle',
      x: fract(baseX + distance * params.drift),
      y: fract(baseY - distance),
      radius: params.size * (0.5 + speed * 0.5),
      color: { ...params.color },
      opacity: 0.35 + speed * 0.65
    }
  })
}

function sampleSpec(
  spec: EffectSpec,
  timeMs: number,
  reduced = false,
  supported = true
): EffectSample {
  let status: EffectSample['status'] = 'active'
  let effectiveTimeMs: number
  if (reduced) {
    if (spec.reducedMotion.mode === 'disable') {
      return { status: 'disabled', effectiveTimeMs: 0, blendMode: spec.blendMode,
        opacity: 0, maxRasterPixels: spec.budget.maxRasterPixels, primitives: [] }
    }
    status = 'static'
    effectiveTimeMs = spec.reducedMotion.timeMs
  } else if (!supported) {
    if (spec.fallback.kind === 'none') {
      return { status: 'disabled', effectiveTimeMs: 0, blendMode: spec.blendMode,
        opacity: 0, maxRasterPixels: spec.budget.maxRasterPixels, primitives: [] }
    }
    status = 'static'
    effectiveTimeMs = spec.fallback.timeMs
  } else {
    effectiveTimeMs = timeMs * spec.uniforms.time.scale + spec.uniforms.time.offsetMs
  }
  const primitives = (
    spec.params.preset === 'noise' ? noise(spec, effectiveTimeMs) :
    spec.params.preset === 'shimmer' ? shimmer(spec, effectiveTimeMs) :
    spec.params.preset === 'scanlines' ? scanlines(spec, effectiveTimeMs) :
    particles(spec, effectiveTimeMs)
  ).slice(0, spec.budget.maxPrimitives)
  return {
    status,
    effectiveTimeMs,
    blendMode: spec.blendMode,
    opacity: spec.opacity,
    maxRasterPixels: spec.budget.maxRasterPixels,
    primitives
  }
}

function sampleRaw(
  raw: string,
  timeMs: number,
  reduced = false,
  supported = true
): EffectSample | null {
  const spec = decode(raw)
  return spec ? sampleSpec(spec, Number.isFinite(timeMs) ? timeMs : 0, reduced, supported) : null
}

  function cssColor(color: EffectColor, alpha: number): string {
    const byte = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)
      .toString(16).padStart(2, '0')
    return '#' + byte(color.r) + byte(color.g) + byte(color.b) + byte(color.a * alpha)
}

function resize(entry: RuntimeEntry): { width: number; height: number } | null {
  const rect = entry.host.getBoundingClientRect()
  const width = entry.host.clientWidth || rect.width
  const height = entry.host.clientHeight || rect.height
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const nativeRatio = Math.max(1, window.devicePixelRatio || 1)
  const budgetRatio = Math.sqrt(entry.spec.budget.maxRasterPixels / (width * height))
  const ratio = Math.max(0.01, Math.min(nativeRatio, budgetRatio))
  const pixelWidth = Math.max(1, Math.floor(width * ratio))
  const pixelHeight = Math.max(1, Math.floor(height * ratio))
  if (entry.canvas.width !== pixelWidth) entry.canvas.width = pixelWidth
  if (entry.canvas.height !== pixelHeight) entry.canvas.height = pixelHeight
  entry.context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0)
  return { width, height }
}

function draw(entry: RuntimeEntry, timeMs: number, reduced: boolean): void {
  const size = resize(entry)
  if (!size) return
  const sample = sampleSpec(entry.spec, timeMs, reduced)
  const context = entry.context
  context.clearRect(0, 0, size.width, size.height)
  if (sample.status === 'disabled' || sample.opacity <= 0) return
  context.globalCompositeOperation = sample.blendMode === 'normal' ? 'source-over' : sample.blendMode
  for (const primitive of sample.primitives) {
    context.fillStyle = cssColor(primitive.color, primitive.opacity * sample.opacity)
    if (primitive.kind === 'circle') {
      context.beginPath()
      context.arc(
        primitive.x * size.width,
        primitive.y * size.height,
        primitive.radius * Math.min(size.width, size.height),
        0,
        Math.PI * 2
      )
      context.fill()
      continue
    }
    const x = primitive.x * size.width
    const y = primitive.y * size.height
    const width = primitive.width * size.width
    const height = primitive.height * size.height
    if (primitive.rotation) {
      context.save()
      context.translate(x + width / 2, y + height / 2)
      context.rotate((primitive.rotation * Math.PI) / 180)
      context.fillRect(-width / 2, -height / 2, width, height)
      context.restore()
    } else context.fillRect(x, y, width, height)
  }
  context.globalCompositeOperation = 'source-over'
}

function removeEntry(host: HTMLElement): void {
  const entry = entries.get(host)
  if (!entry) return
  entry.canvas.remove()
  if (entry.changedPosition && host.style.position === 'relative') {
    host.style.position = entry.inlinePosition
  }
  entries.delete(host)
}

function createEntry(host: HTMLElement, spec: EffectSpec): RuntimeEntry | null {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return null
  canvas.dataset.opGeneratedEffectLayer = 'true'
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none'
  })
  const inlinePosition = host.style.position
  const changedPosition = getComputedStyle(host).position === 'static'
  if (changedPosition) host.style.position = 'relative'
  host.append(canvas)
  return { host, canvas, context, spec, inlinePosition, changedPosition }
}

function refresh(): void {
  if (disposed) return
  const seen = new Set<HTMLElement>()
  for (const candidate of document.querySelectorAll<HTMLElement>(SELECTOR)) {
    const raw = candidate.dataset.opGeneratedEffect
    const spec = raw ? decode(raw) : null
    if (!spec) {
      removeEntry(candidate)
      continue
    }
    seen.add(candidate)
    const current = entries.get(candidate)
    if (current) current.spec = spec
    else {
      const created = createEntry(candidate, spec)
      if (created) entries.set(candidate, created)
    }
  }
  for (const host of entries.keys()) {
    if (!seen.has(host) || !host.isConnected) removeEntry(host)
  }
  renderAt(performance.now())
  scheduleAnimation()
}

const media = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null

function renderAt(timeMs: number): void {
  const safeTime = Number.isFinite(timeMs) ? timeMs : 0
  for (const entry of entries.values()) draw(entry, safeTime, media?.matches === true)
}

function shouldAnimate(): boolean {
  if (media?.matches) return false
  for (const entry of entries.values()) {
    if (entry.spec.uniforms.time.scale > 0 && entry.spec.uniforms.time.frequencyHz > 0) return true
  }
  return false
}

function scheduleAnimation(): void {
  if (disposed || animationFrame !== null || !shouldAnimate()) return
  animationFrame = requestAnimationFrame(tick)
}

function tick(timeMs: number): void {
  animationFrame = null
  if (disposed) return
  renderAt(timeMs)
  scheduleAnimation()
}

function dispose(): void {
  if (disposed) return
  disposed = true
  observer?.disconnect()
  observer = null
  if (animationFrame !== null) cancelAnimationFrame(animationFrame)
  animationFrame = null
  media?.removeEventListener?.('change', onReducedMotionChange)
  for (const host of [...entries.keys()]) removeEntry(host)
  if (window.__OPENPENCIL_GENERATED_EFFECT_RUNTIME__ === runtime) {
    delete window.__OPENPENCIL_GENERATED_EFFECT_RUNTIME__
  }
}

function onReducedMotionChange(): void {
  renderAt(performance.now())
  scheduleAnimation()
}

function start(): void {
  if (disposed) return
  refresh()
  observer = new MutationObserver(refresh)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-op-generated-effect']
  })
  media?.addEventListener?.('change', onReducedMotionChange)
}

const runtime: GeneratedEffectRuntime = {
  renderAt,
  refresh,
  dispose,
  inspect: () => ({
    activeLayerCount: entries.size,
    nodeIds: [...entries.keys()].map((host) => host.dataset.opGeneratedEffectNode ?? '')
  }),
  sample: sampleRaw
}

window.__OPENPENCIL_GENERATED_EFFECT_RUNTIME__?.dispose()
window.__OPENPENCIL_GENERATED_EFFECT_RUNTIME__ = runtime
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
else start()

export {}
`
}
