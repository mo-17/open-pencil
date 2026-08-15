import {
  assertBoundedPluginConfigBytes,
  hasExactPluginKeys,
  isSafePluginHref,
  mergePluginConfigWithDefaults,
  parseBoundedPluginText as boundedText,
  parseCanonicalPluginColor as canonicalColor,
  parseCanonicalPublicHttpsURL
} from '@open-pencil/plugin-contracts/adapter-helpers'
import {
  isPlainJSONObject,
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneNode
} from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { createModuleFrameOverrides } from './module-frame'
import type { ModuleDefinition, ModulePropertyField, ModuleResolution } from './types'

export const CAROUSEL_PLUGIN_ID = 'open-pencil.carousel'
export const CAROUSEL_MODULE_TYPE = 'carousel'
export const CAROUSEL_MODULE_CONFIG_VERSION = 1
export const CAROUSEL_MODULE_DEFAULT_SIZE = Object.freeze({ width: 640, height: 360 })
export const CAROUSEL_MODULE_LIMITS = Object.freeze({
  slides: 12,
  label: 120,
  title: 120,
  description: 1_000,
  imageUrl: 2_048,
  alt: 240,
  href: 2_048,
  intervalMsMin: 2_000,
  intervalMsMax: 60_000,
  configBytes: 48 * 1024
})

export type CarouselTransitionV1 = 'slide' | 'fade'

export interface CarouselSlideV1 extends JSONObject {
  title: string
  description: string
  imageUrl: string
  alt: string
  href: string
}

export interface CarouselModuleConfigV1 extends JSONObject {
  label: string
  slides: CarouselSlideV1[]
  initialIndex: number
  transition: CarouselTransitionV1
  autoplay: boolean
  intervalMs: number
  loop: boolean
  showArrows: boolean
  showDots: boolean
  pauseOnHover: boolean
  backgroundColor: string
  textColor: string
  accentColor: string
}

export type CarouselModuleConfig = CarouselModuleConfigV1

const DEFAULT_SLIDES: CarouselSlideV1[] = [
  {
    title: 'Build visually',
    description: 'Compose an editable experience on the OpenPencil canvas.',
    imageUrl: '',
    alt: '',
    href: ''
  },
  {
    title: 'Compile confidently',
    description: 'Preview the same bounded content in a runnable application.',
    imageUrl: '',
    alt: '',
    href: ''
  },
  {
    title: 'Ship anywhere',
    description: 'Keep a deterministic static fallback for unsupported targets.',
    imageUrl: '',
    alt: '',
    href: ''
  }
]
DEFAULT_SLIDES.forEach(Object.freeze)
Object.freeze(DEFAULT_SLIDES)

export const CAROUSEL_MODULE_DEFAULT_CONFIG: Readonly<CarouselModuleConfigV1> = Object.freeze({
  label: 'Featured content',
  slides: DEFAULT_SLIDES,
  initialIndex: 0,
  transition: 'slide',
  autoplay: false,
  intervalMs: 5_000,
  loop: true,
  showArrows: true,
  showDots: true,
  pauseOnHover: true,
  backgroundColor: '#111827',
  textColor: '#FFFFFF',
  accentColor: '#60A5FA'
})

const CONFIG_KEYS = new Set([
  'label',
  'slides',
  'initialIndex',
  'transition',
  'autoplay',
  'intervalMs',
  'loop',
  'showArrows',
  'showDots',
  'pauseOnHover',
  'backgroundColor',
  'textColor',
  'accentColor'
])
const SLIDE_KEYS = new Set(['title', 'description', 'imageUrl', 'alt', 'href'])
const TRANSITIONS = new Set<CarouselTransitionV1>(['slide', 'fade'])
type ParseResult = { ok: true; config: CarouselModuleConfigV1 } | { ok: false; reason: string }

export function isSafeCarouselHref(value: unknown): value is string {
  return isSafePluginHref(value, 'carousel slide href', CAROUSEL_MODULE_LIMITS.href, true)
}

function parseImageURL(value: unknown, path: string): string {
  if (value === '') return ''
  return parseCanonicalPublicHttpsURL(value, path, CAROUSEL_MODULE_LIMITS.imageUrl)
}

function parseSlides(value: unknown): CarouselSlideV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > CAROUSEL_MODULE_LIMITS.slides) {
    throw new TypeError(
      `carousel config slides must contain 1 to ${CAROUSEL_MODULE_LIMITS.slides} slides`
    )
  }
  return Array.from(value, (entry, index) => {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`carousel config slides[${index}] must be a slide object`)
    }
    if (!isPlainJSONObject(entry) || !hasExactPluginKeys(entry, SLIDE_KEYS)) {
      throw new TypeError(
        `carousel config slides[${index}] must contain exactly title, description, imageUrl, alt, and href`
      )
    }
    const title = boundedText(
      entry.title,
      `carousel config slides[${index}].title`,
      1,
      CAROUSEL_MODULE_LIMITS.title
    )
    const description = boundedText(
      entry.description,
      `carousel config slides[${index}].description`,
      0,
      CAROUSEL_MODULE_LIMITS.description
    )
    const imageURL = parseImageURL(entry.imageUrl, `carousel config slides[${index}].imageUrl`)
    const alt = boundedText(
      entry.alt,
      `carousel config slides[${index}].alt`,
      imageURL === '' ? 0 : 1,
      CAROUSEL_MODULE_LIMITS.alt
    )
    if (imageURL === '' && alt !== '') {
      throw new TypeError(`carousel config slides[${index}].alt must be empty without an imageUrl`)
    }
    if (!isSafeCarouselHref(entry.href)) {
      throw new TypeError(`carousel config slides[${index}].href must be a safe bounded href`)
    }
    return { title, description, imageUrl: imageURL, alt, href: entry.href }
  })
}

function parseCarouselConfig(value: unknown): ParseResult {
  if (!isPlainJSONObject(value) || !hasExactPluginKeys(value, CONFIG_KEYS)) {
    return {
      ok: false,
      reason:
        'carousel config must contain exactly label, slides, initialIndex, transition, autoplay, intervalMs, loop, showArrows, showDots, pauseOnHover, backgroundColor, textColor, and accentColor'
    }
  }
  try {
    const label = boundedText(value.label, 'carousel config label', 1, CAROUSEL_MODULE_LIMITS.label)
    const slides = parseSlides(value.slides)
    if (
      !Number.isSafeInteger(value.initialIndex) ||
      (value.initialIndex as number) < 0 ||
      (value.initialIndex as number) >= slides.length
    ) {
      throw new TypeError(`carousel config initialIndex must select an existing slide`)
    }
    if (typeof value.transition !== 'string' || !TRANSITIONS.has(value.transition as never)) {
      throw new TypeError('carousel config transition must be slide or fade')
    }
    if (
      !Number.isSafeInteger(value.intervalMs) ||
      (value.intervalMs as number) < CAROUSEL_MODULE_LIMITS.intervalMsMin ||
      (value.intervalMs as number) > CAROUSEL_MODULE_LIMITS.intervalMsMax
    ) {
      throw new TypeError(
        `carousel config intervalMs must be between ${CAROUSEL_MODULE_LIMITS.intervalMsMin} and ${CAROUSEL_MODULE_LIMITS.intervalMsMax}`
      )
    }
    for (const key of ['autoplay', 'loop', 'showArrows', 'showDots', 'pauseOnHover'] as const) {
      if (typeof value[key] !== 'boolean') {
        throw new TypeError(`carousel config ${key} must be a boolean`)
      }
    }
    const config: CarouselModuleConfigV1 = {
      label,
      slides,
      initialIndex: value.initialIndex as number,
      transition: value.transition as CarouselTransitionV1,
      autoplay: value.autoplay as boolean,
      intervalMs: value.intervalMs as number,
      loop: value.loop as boolean,
      showArrows: value.showArrows as boolean,
      showDots: value.showDots as boolean,
      pauseOnHover: value.pauseOnHover as boolean,
      backgroundColor: canonicalColor(value.backgroundColor, 'carousel config backgroundColor'),
      textColor: canonicalColor(value.textColor, 'carousel config textColor'),
      accentColor: canonicalColor(value.accentColor, 'carousel config accentColor')
    }
    assertBoundedPluginConfigBytes(config, 'carousel config', CAROUSEL_MODULE_LIMITS.configBytes)
    return { ok: true, config }
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) }
  }
}

export function createCarouselModuleInstance(config?: unknown): ModuleInstanceV1 {
  const parsed = parseCarouselConfig(
    mergePluginConfigWithDefaults(CAROUSEL_MODULE_DEFAULT_CONFIG, config)
  )
  if (!parsed.ok) throw new TypeError(parsed.reason)
  return {
    version: 1,
    pluginId: CAROUSEL_PLUGIN_ID,
    moduleType: CAROUSEL_MODULE_TYPE,
    configVersion: CAROUSEL_MODULE_CONFIG_VERSION,
    config: parsed.config
  }
}

export function createCarouselModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Carousel',
    defaultSize: CAROUSEL_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.07, g: 0.09, b: 0.15, a: 1 },
    strokeColor: { r: 0.23, g: 0.29, b: 0.39, a: 1 },
    module: createCarouselModuleInstance(config)
  })
}

export function resolveCarouselModule(value: unknown): ModuleResolution<CarouselModuleConfigV1> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (
    instance.value.pluginId !== CAROUSEL_PLUGIN_ID ||
    instance.value.moduleType !== CAROUSEL_MODULE_TYPE
  ) {
    return null
  }
  if (instance.value.configVersion !== CAROUSEL_MODULE_CONFIG_VERSION) {
    return {
      ok: false,
      reason: `unsupported carousel config version ${instance.value.configVersion}`
    }
  }
  const parsed = parseCarouselConfig(instance.value.config)
  if (!parsed.ok) return parsed
  return {
    ok: true,
    instance: { ...instance.value, config: parsed.config },
    config: parsed.config
  }
}

const CAROUSEL_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  { path: ['label'], kind: 'text', label: 'Accessible label' },
  { path: ['slides'], kind: 'json', label: 'Slides' },
  { path: ['initialIndex'], kind: 'number', label: 'Initial slide', min: 0, max: 11, step: 1 },
  { path: ['transition'], kind: 'select', label: 'Transition', options: ['slide', 'fade'] },
  { path: ['autoplay'], kind: 'boolean', label: 'Autoplay' },
  {
    path: ['intervalMs'],
    kind: 'number',
    label: 'Autoplay interval',
    min: CAROUSEL_MODULE_LIMITS.intervalMsMin,
    max: CAROUSEL_MODULE_LIMITS.intervalMsMax,
    step: 500
  },
  { path: ['loop'], kind: 'boolean', label: 'Loop' },
  { path: ['showArrows'], kind: 'boolean', label: 'Show arrows' },
  { path: ['showDots'], kind: 'boolean', label: 'Show dots' },
  { path: ['pauseOnHover'], kind: 'boolean', label: 'Pause on hover' },
  { path: ['backgroundColor'], kind: 'color', label: 'Background color' },
  { path: ['textColor'], kind: 'color', label: 'Text color' },
  { path: ['accentColor'], kind: 'color', label: 'Accent color' }
])

export const CAROUSEL_MODULE_DEFINITION: ModuleDefinition<CarouselModuleConfigV1> = Object.freeze({
  pluginId: CAROUSEL_PLUGIN_ID,
  moduleType: CAROUSEL_MODULE_TYPE,
  name: 'Carousel',
  description: 'A bounded, accessible carousel with optional safe remote media and links.',
  configVersion: CAROUSEL_MODULE_CONFIG_VERSION,
  defaultSize: CAROUSEL_MODULE_DEFAULT_SIZE,
  defaultConfig: structuredClone(CAROUSEL_MODULE_DEFAULT_CONFIG),
  fields: CAROUSEL_MODULE_FIELDS,
  createInstance: createCarouselModuleInstance,
  createFrameOverrides: createCarouselModuleFrameOverrides,
  resolve: resolveCarouselModule
})

export const CAROUSEL_PLUGIN = Object.freeze({
  id: CAROUSEL_PLUGIN_ID,
  name: 'OpenPencil Carousel',
  version: '1.0.0',
  modules: Object.freeze([CAROUSEL_MODULE_DEFINITION])
})
