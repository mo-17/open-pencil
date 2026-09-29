import {
  assertBoundedPluginConfigBytes,
  hasExactPluginKeys,
  isSafePluginHref,
  mergePluginConfigWithDefaults,
  parseBoundedPluginNumber,
  parseBoundedPluginText as boundedText,
  parseCanonicalPluginColor as canonicalColor,
  parseCanonicalPublicHttpsURL,
  parsePluginStringEnum
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
export const CAROUSEL_MODULE_CONFIG_VERSION = 3
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

export type CarouselLayoutV2 = 'split' | 'overlay'
export type CarouselImageFitV2 = 'cover' | 'contain' | 'fill'
export type CarouselTextPositionV2 = 'top' | 'center' | 'bottom'
export type CarouselTextAlignV2 = 'left' | 'center' | 'right'
export type CarouselPaginationStyleV2 = 'dots' | 'numbers' | 'fraction'

export interface CarouselModuleConfigV2 extends CarouselModuleConfigV1 {
  layout: CarouselLayoutV2
  imageFit: CarouselImageFitV2
  textPosition: CarouselTextPositionV2
  textAlign: CarouselTextAlignV2
  overlayOpacity: number
  paginationStyle: CarouselPaginationStyleV2
}

export type CarouselArrowPositionV3 =
  | 'sides'
  | 'top-corners'
  | 'bottom-corners'
  | 'bottom-left'
  | 'bottom-right'

export interface CarouselModuleConfigV3 extends CarouselModuleConfigV2 {
  arrowPosition: CarouselArrowPositionV3
  swipeEnabled: boolean
}

export type CarouselModuleConfig = CarouselModuleConfigV3

export const CAROUSEL_NAVIGATION_DEFAULTS = Object.freeze({
  arrowPosition: 'bottom-corners' as const,
  swipeEnabled: true
})

export const CAROUSEL_STYLE_DEFAULTS = Object.freeze({
  layout: 'split' as const,
  imageFit: 'cover' as const,
  textPosition: 'bottom' as const,
  textAlign: 'left' as const,
  overlayOpacity: 0.45,
  paginationStyle: 'dots' as const
})

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

export const CAROUSEL_MODULE_DEFAULT_CONFIG: Readonly<CarouselModuleConfigV3> = Object.freeze({
  ...CAROUSEL_STYLE_DEFAULTS,
  ...CAROUSEL_NAVIGATION_DEFAULTS,
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

const LEGACY_CONFIG_KEYS = new Set([
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
const STYLE_CONFIG_KEYS = new Set([...LEGACY_CONFIG_KEYS, ...Object.keys(CAROUSEL_STYLE_DEFAULTS)])
const CONFIG_KEYS = new Set([...STYLE_CONFIG_KEYS, ...Object.keys(CAROUSEL_NAVIGATION_DEFAULTS)])
const SLIDE_KEYS = new Set(['title', 'description', 'imageUrl', 'alt', 'href'])
const TRANSITIONS = new Set<CarouselTransitionV1>(['slide', 'fade'])
const LAYOUTS = new Set<CarouselLayoutV2>(['split', 'overlay'])
const IMAGE_FITS = new Set<CarouselImageFitV2>(['cover', 'contain', 'fill'])
const TEXT_POSITIONS = new Set<CarouselTextPositionV2>(['top', 'center', 'bottom'])
const TEXT_ALIGNS = new Set<CarouselTextAlignV2>(['left', 'center', 'right'])
const PAGINATION_STYLES = new Set<CarouselPaginationStyleV2>(['dots', 'numbers', 'fraction'])
const ARROW_POSITIONS = new Set<CarouselArrowPositionV3>([
  'sides',
  'top-corners',
  'bottom-corners',
  'bottom-left',
  'bottom-right'
])
type ParseResult = { ok: true; config: CarouselModuleConfigV3 } | { ok: false; reason: string }

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

function carouselConfigKeys(version: number): ReadonlySet<string> {
  if (version === 1) return LEGACY_CONFIG_KEYS
  if (version === 2) return STYLE_CONFIG_KEYS
  return CONFIG_KEYS
}

function parseCarouselNavigation(
  value: JSONObject,
  version: number
): Pick<CarouselModuleConfigV3, 'arrowPosition' | 'swipeEnabled'> {
  if (version < 3) return { ...CAROUSEL_NAVIGATION_DEFAULTS, swipeEnabled: false }
  if (typeof value.swipeEnabled !== 'boolean') {
    throw new TypeError('carousel config swipeEnabled must be a boolean')
  }
  return {
    arrowPosition: parsePluginStringEnum(
      value.arrowPosition,
      'carousel config arrowPosition',
      ARROW_POSITIONS,
      'sides, top-corners, bottom-corners, bottom-left, or bottom-right'
    ),
    swipeEnabled: value.swipeEnabled
  }
}

function parseCarouselConfig(
  value: unknown,
  configVersion = CAROUSEL_MODULE_CONFIG_VERSION
): ParseResult {
  const keys = carouselConfigKeys(configVersion)
  if (!isPlainJSONObject(value) || !hasExactPluginKeys(value, keys)) {
    return {
      ok: false,
      reason: `carousel config must contain exactly ${[...keys].join(', ')}`
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
    const legacy: CarouselModuleConfigV1 = {
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
    const styled: CarouselModuleConfigV2 = {
      ...legacy,
      ...(configVersion === 1
        ? CAROUSEL_STYLE_DEFAULTS
        : {
            layout: parsePluginStringEnum(
              value.layout,
              'carousel config layout',
              LAYOUTS,
              'split or overlay'
            ),
            imageFit: parsePluginStringEnum(
              value.imageFit,
              'carousel config imageFit',
              IMAGE_FITS,
              'cover, contain, or fill'
            ),
            textPosition: parsePluginStringEnum(
              value.textPosition,
              'carousel config textPosition',
              TEXT_POSITIONS,
              'top, center, or bottom'
            ),
            textAlign: parsePluginStringEnum(
              value.textAlign,
              'carousel config textAlign',
              TEXT_ALIGNS,
              'left, center, or right'
            ),
            overlayOpacity: parseBoundedPluginNumber(
              value.overlayOpacity,
              'carousel config overlayOpacity',
              0,
              0.9
            ),
            paginationStyle: parsePluginStringEnum(
              value.paginationStyle,
              'carousel config paginationStyle',
              PAGINATION_STYLES,
              'dots, numbers, or fraction'
            )
          })
    }
    const config: CarouselModuleConfigV3 = {
      ...styled,
      ...parseCarouselNavigation(value, configVersion)
    }
    let serializedConfig: JSONObject = config
    if (configVersion === 1) serializedConfig = legacy
    if (configVersion === 2) serializedConfig = styled
    assertBoundedPluginConfigBytes(
      serializedConfig,
      'carousel config',
      CAROUSEL_MODULE_LIMITS.configBytes
    )
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

export function resolveCarouselModule(value: unknown): ModuleResolution<CarouselModuleConfigV3> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (
    instance.value.pluginId !== CAROUSEL_PLUGIN_ID ||
    instance.value.moduleType !== CAROUSEL_MODULE_TYPE
  ) {
    return null
  }
  if (
    instance.value.configVersion !== 1 &&
    instance.value.configVersion !== 2 &&
    instance.value.configVersion !== CAROUSEL_MODULE_CONFIG_VERSION
  ) {
    return {
      ok: false,
      reason: `unsupported carousel config version ${instance.value.configVersion}`
    }
  }
  const parsed = parseCarouselConfig(instance.value.config, instance.value.configVersion)
  if (!parsed.ok) return parsed
  return {
    ok: true,
    instance: {
      ...instance.value,
      configVersion: CAROUSEL_MODULE_CONFIG_VERSION,
      config: parsed.config
    },
    config: parsed.config
  }
}

const CAROUSEL_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  { path: ['label'], kind: 'text', label: 'Accessible label' },
  { path: ['slides'], kind: 'json', label: 'Slides' },
  { path: ['initialIndex'], kind: 'number', label: 'Initial slide', min: 0, max: 11, step: 1 },
  { path: ['layout'], kind: 'select', label: 'Layout', options: ['split', 'overlay'] },
  { path: ['imageFit'], kind: 'select', label: 'Image fit', options: ['cover', 'contain', 'fill'] },
  {
    path: ['textPosition'],
    kind: 'select',
    label: 'Text position',
    options: ['top', 'center', 'bottom']
  },
  {
    path: ['textAlign'],
    kind: 'select',
    label: 'Text alignment',
    options: ['left', 'center', 'right']
  },
  {
    path: ['overlayOpacity'],
    kind: 'number',
    label: 'Overlay opacity',
    min: 0,
    max: 0.9,
    step: 0.05
  },
  {
    path: ['paginationStyle'],
    kind: 'select',
    label: 'Pagination style',
    options: ['dots', 'numbers', 'fraction']
  },
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
  {
    path: ['arrowPosition'],
    kind: 'select',
    label: 'Arrow position',
    options: [...ARROW_POSITIONS]
  },
  { path: ['swipeEnabled'], kind: 'boolean', label: 'Drag or swipe to switch' },
  { path: ['showDots'], kind: 'boolean', label: 'Show pagination' },
  { path: ['pauseOnHover'], kind: 'boolean', label: 'Pause on hover' },
  { path: ['backgroundColor'], kind: 'color', label: 'Background color' },
  { path: ['textColor'], kind: 'color', label: 'Text color' },
  { path: ['accentColor'], kind: 'color', label: 'Accent color' }
])

export const CAROUSEL_MODULE_DEFINITION: ModuleDefinition<CarouselModuleConfigV3> = Object.freeze({
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
