import type { MotionVisualState } from '@open-pencil/motion'
import { TRANSPARENT } from '@open-pencil/scene-graph'

import { colorToCSS } from './color'

export interface MotionStyleDeclaration {
  getPropertyValue(property: string): string
  getPropertyPriority(property: string): string
  setProperty(property: string, value: string, priority?: string): void
  removeProperty(property: string): string
}

export interface MotionStyleTarget {
  readonly style: MotionStyleDeclaration
}

export type DOMMotionAdvancedChannel =
  | 'paints'
  | 'gradientStops'
  | 'effects'
  | 'textReveal'
  | 'vectorMorph'

export const DOM_MOTION_ADVANCED_CHANNELS: readonly DOMMotionAdvancedChannel[] = Object.freeze([
  'paints',
  'gradientStops',
  'effects',
  'textReveal',
  'vectorMorph'
])

const DOM_MOTION_ADVANCED_CHANNEL_SET = new Set(DOM_MOTION_ADVANCED_CHANNELS)

export interface MotionTextContentAdapter {
  /** Reads the authored text snapshot when the target is created. */
  read(): string
  /** Replaces the rendered text without changing the surrounding target element. */
  write(value: string): void
}

export class DOMMotionCapabilityError extends Error {
  readonly code = 'DOM_MOTION_CAPABILITY_UNSUPPORTED'
  readonly channels: readonly DOMMotionAdvancedChannel[]

  constructor(channels: readonly DOMMotionAdvancedChannel[]) {
    super(`DOM Motion target cannot faithfully project channels: ${channels.join(', ')}`)
    this.name = 'DOMMotionCapabilityError'
    this.channels = Object.freeze([...channels])
  }
}

export interface DOMMotionTargetOptions {
  /** Authored opacity multiplied by the sampled Motion opacity. Defaults to the inline value or 1. */
  readonly authoredOpacity?: number
  /** Authored transform prepended to Motion transforms. Defaults to the inline transform. */
  readonly authoredTransform?: string
  /** Unicode-safe authored text access for the built-in textReveal projection. */
  readonly textContent?: MotionTextContentAdapter
  /**
   * Explicit channels implemented by applyAdvanced. Undeclared structured channels fail closed
   * before any style is changed.
   */
  readonly advancedCapabilities?: readonly DOMMotionAdvancedChannel[]
  /** Receives only structured channels explicitly declared through advancedCapabilities. */
  readonly applyAdvanced?: (target: MotionStyleTarget, visual: MotionVisualState) => void
  readonly clearAdvanced?: (target: MotionStyleTarget) => void
}

export interface DOMMotionTarget {
  readonly advancedCapabilities: readonly DOMMotionAdvancedChannel[]
  apply(visual: MotionVisualState): void
  restore(): void
}

const STYLE_PROPERTIES = Object.freeze([
  'transform',
  'transform-origin',
  'opacity',
  'width',
  'height',
  'border-radius',
  'background-color',
  'border-color',
  'border-width',
  'filter',
  'box-shadow',
  'font-variation-settings',
  'gap',
  'row-gap',
  'column-gap',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left'
] as const)

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function px(value: number): string {
  return `${finite(value, 0)}px`
}

function setOptionalNumber(
  style: MotionStyleDeclaration,
  property: string,
  value: number | undefined
): void {
  if (value !== undefined) style.setProperty(property, px(value))
}

function transformValue(authored: string, visual: MotionVisualState): string {
  const motion = `translate3d(${px(visual.x)}, ${px(visual.y)}, 0) rotate(${finite(visual.rotate, 0)}deg) scale(${finite(visual.scaleX, 1)}, ${finite(visual.scaleY, 1)})`
  return authored && authored !== 'none' ? `${authored} ${motion}` : motion
}

function applyGeometry(style: MotionStyleDeclaration, visual: MotionVisualState): void {
  if (visual.originX !== undefined || visual.originY !== undefined) {
    style.setProperty(
      'transform-origin',
      `${(visual.originX ?? 0.5) * 100}% ${(visual.originY ?? 0.5) * 100}%`
    )
  }
  setOptionalNumber(style, 'width', visual.width)
  setOptionalNumber(style, 'height', visual.height)
  if (visual.cornerRadii) {
    style.setProperty(
      'border-radius',
      [
        visual.cornerRadii.topLeft,
        visual.cornerRadii.topRight,
        visual.cornerRadii.bottomRight,
        visual.cornerRadii.bottomLeft
      ]
        .map(px)
        .join(' ')
    )
  } else setOptionalNumber(style, 'border-radius', visual.cornerRadius)
}

function applyPaintAndEffects(style: MotionStyleDeclaration, visual: MotionVisualState): void {
  if (visual.fillColor) style.setProperty('background-color', colorToCSS(visual.fillColor))
  if (visual.strokeColor) style.setProperty('border-color', colorToCSS(visual.strokeColor))
  setOptionalNumber(style, 'border-width', visual.strokeWidth)
  if (visual.blur !== undefined) style.setProperty('filter', `blur(${px(visual.blur)})`)
  if (
    visual.shadowX === undefined &&
    visual.shadowY === undefined &&
    visual.shadowBlur === undefined &&
    visual.shadowSpread === undefined &&
    !visual.shadowColor
  ) {
    return
  }
  style.setProperty(
    'box-shadow',
    `${px(visual.shadowX ?? 0)} ${px(visual.shadowY ?? 0)} ${px(visual.shadowBlur ?? 0)} ${px(visual.shadowSpread ?? 0)} ${colorToCSS(visual.shadowColor ?? TRANSPARENT)}`
  )
}

function applyTextAndLayout(style: MotionStyleDeclaration, visual: MotionVisualState): void {
  if (visual.fontAxes) {
    style.setProperty(
      'font-variation-settings',
      visual.fontAxes.map((axis) => `'${axis.tag}' ${axis.value}`).join(', ')
    )
  }
  setOptionalNumber(style, 'gap', visual.gap)
  setOptionalNumber(style, 'row-gap', visual.rowGap)
  setOptionalNumber(style, 'column-gap', visual.columnGap)
  setOptionalNumber(style, 'padding-top', visual.paddingTop)
  setOptionalNumber(style, 'padding-right', visual.paddingRight)
  setOptionalNumber(style, 'padding-bottom', visual.paddingBottom)
  setOptionalNumber(style, 'padding-left', visual.paddingLeft)
}

type CustomPropertySetter = (property: string, value: string) => void

function applyProgressProperties(setCustom: CustomPropertySetter, visual: MotionVisualState): void {
  const values = [
    ['--open-pencil-motion-path-progress', visual.pathProgress],
    ['--open-pencil-motion-trim-start', visual.trimStart],
    ['--open-pencil-motion-trim-end', visual.trimEnd],
    ['--open-pencil-motion-trim-offset', visual.trimOffset]
  ] as const
  for (const [property, value] of values) {
    if (value !== undefined) setCustom(property, String(value))
  }
}

function applyStructuredPaints(setCustom: CustomPropertySetter, visual: MotionVisualState): void {
  for (const paint of visual.paints ?? []) {
    const prefix = `--open-pencil-motion-${paint.kind}-${paint.index}`
    if (paint.color) setCustom(`${prefix}-color`, colorToCSS(paint.color))
    if (paint.opacity !== undefined) setCustom(`${prefix}-opacity`, String(paint.opacity))
  }
  for (const stop of visual.gradientStops ?? []) {
    const prefix = `--open-pencil-motion-${stop.kind}-${stop.paintIndex}-stop-${stop.stopIndex}`
    setCustom(`${prefix}-position`, String(stop.position))
    setCustom(`${prefix}-color`, colorToCSS(stop.color))
  }
}

function requestedAdvancedChannels(visual: MotionVisualState): DOMMotionAdvancedChannel[] {
  const channels: DOMMotionAdvancedChannel[] = []
  if (visual.paints && visual.paints.length > 0) channels.push('paints')
  if (visual.gradientStops && visual.gradientStops.length > 0) channels.push('gradientStops')
  if (visual.effects && visual.effects.length > 0) channels.push('effects')
  if (visual.textReveal !== undefined) channels.push('textReveal')
  if (visual.vectorMorph !== undefined) channels.push('vectorMorph')
  return channels
}

function validateAdvancedCapabilities(
  visual: MotionVisualState,
  capabilities: ReadonlySet<DOMMotionAdvancedChannel>,
  hasTextContent: boolean
): void {
  const unsupported = requestedAdvancedChannels(visual).filter(
    (channel) => !(channel === 'textReveal' && hasTextContent) && !capabilities.has(channel)
  )
  if (unsupported.length > 0) throw new DOMMotionCapabilityError(unsupported)
}

function revealedText(authored: string, progress: number): string {
  const characters = Array.from(authored)
  const normalized = Math.min(1, Math.max(0, finite(progress, 0)))
  return characters.slice(0, Math.round(characters.length * normalized)).join('')
}

function declaredAdvancedCapabilities(
  options: DOMMotionTargetOptions
): Set<DOMMotionAdvancedChannel> {
  const requested = options.advancedCapabilities ?? []
  if (requested.length > DOM_MOTION_ADVANCED_CHANNELS.length) {
    throw new RangeError('advancedCapabilities exceeds the supported channel count')
  }
  const capabilities = new Set<DOMMotionAdvancedChannel>()
  for (const channel of requested) {
    if (!DOM_MOTION_ADVANCED_CHANNEL_SET.has(channel)) {
      throw new TypeError(`Unknown DOM Motion advanced capability: ${String(channel)}`)
    }
    capabilities.add(channel)
  }
  if (capabilities.size !== requested.length) {
    throw new TypeError('advancedCapabilities must not contain duplicates')
  }
  if (capabilities.size > 0 && !options.applyAdvanced) {
    throw new TypeError('advancedCapabilities requires applyAdvanced')
  }
  return capabilities
}

/** Creates a reversible DOM style projection. It does not read window/document at import time. */
export function createDOMMotionTarget(
  target: MotionStyleTarget,
  options: DOMMotionTargetOptions = {}
): DOMMotionTarget {
  const style = target.style
  const initial = new Map<string, { value: string; priority: string }>()
  const authoredTransform = options.authoredTransform ?? style.getPropertyValue('transform')
  const inlineOpacityText = style.getPropertyValue('opacity').trim()
  const inlineOpacity = Number(inlineOpacityText)
  const authoredOpacity =
    options.authoredOpacity ??
    (inlineOpacityText && Number.isFinite(inlineOpacity) && inlineOpacity >= 0 ? inlineOpacity : 1)
  const customProperties = new Set<string>()
  const declaredCapabilities = declaredAdvancedCapabilities(options)
  const advancedCapabilities = Object.freeze([...declaredCapabilities])
  const authoredText = options.textContent ? options.textContent.read() : undefined
  if (options.textContent && typeof authoredText !== 'string') {
    throw new TypeError('textContent.read() must return a string')
  }
  let textTouched = false

  for (const property of STYLE_PROPERTIES) {
    initial.set(property, {
      value: style.getPropertyValue(property),
      priority: style.getPropertyPriority(property)
    })
  }

  const setCustom = (property: string, value: string) => {
    if (!customProperties.has(property)) {
      initial.set(property, {
        value: style.getPropertyValue(property),
        priority: style.getPropertyPriority(property)
      })
      customProperties.add(property)
    }
    style.setProperty(property, value)
  }

  return {
    advancedCapabilities,
    apply(visual) {
      validateAdvancedCapabilities(visual, declaredCapabilities, authoredText !== undefined)
      if (visual.textReveal !== undefined && authoredText !== undefined && options.textContent) {
        options.textContent.write(revealedText(authoredText, visual.textReveal))
        textTouched = true
      }
      style.setProperty('transform', transformValue(authoredTransform, visual))
      style.setProperty('opacity', String(authoredOpacity * finite(visual.opacity, 1)))
      applyGeometry(style, visual)
      applyPaintAndEffects(style, visual)
      applyTextAndLayout(style, visual)
      applyProgressProperties(setCustom, visual)
      applyStructuredPaints(setCustom, visual)
      options.applyAdvanced?.(target, visual)
    },
    restore() {
      for (const [property, snapshot] of initial) {
        if (snapshot.value) style.setProperty(property, snapshot.value, snapshot.priority)
        else style.removeProperty(property)
      }
      if (textTouched && authoredText !== undefined && options.textContent) {
        options.textContent.write(authoredText)
        textTouched = false
      }
      options.clearAdvanced?.(target)
    }
  }
}
