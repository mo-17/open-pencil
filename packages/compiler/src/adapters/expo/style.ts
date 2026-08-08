import { nativeBorderRadius } from '../native-shared'
import type { ExpoStyleResult, ExpoStyleValue, ExpoWarningSink } from './types'

const COLOR_NAMES: Readonly<Partial<Record<string, string>>> = {
  transparent: 'transparent',
  black: '#000000',
  white: '#FFFFFF',
  background: '#FFFFFF',
  foreground: '#111827',
  primary: '#2563EB',
  'primary-foreground': '#FFFFFF',
  secondary: '#E5E7EB',
  'secondary-foreground': '#111827',
  muted: '#F3F4F6',
  'muted-foreground': '#6B7280',
  border: '#D1D5DB',
  destructive: '#EF4444',
  'destructive-foreground': '#FFFFFF',
  'gray-50': '#F9FAFB',
  'gray-100': '#F3F4F6',
  'gray-200': '#E5E7EB',
  'gray-300': '#D1D5DB',
  'gray-400': '#9CA3AF',
  'gray-500': '#6B7280',
  'gray-600': '#4B5563',
  'gray-700': '#374151',
  'gray-800': '#1F2937',
  'gray-900': '#111827',
  'gray-950': '#030712',
  'blue-500': '#3B82F6',
  'blue-600': '#2563EB',
  'red-500': '#EF4444',
  'green-500': '#22C55E',
  'yellow-500': '#EAB308'
}

const TEXT_SIZES: Readonly<Partial<Record<string, number>>> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
  '6xl': 60,
  '7xl': 72,
  '8xl': 96,
  '9xl': 128
}

const FONT_WEIGHTS: Readonly<Partial<Record<string, string>>> = {
  thin: '100',
  extralight: '200',
  light: '300',
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900'
}

const WEB_ONLY_UTILITY_RE =
  /^(?:appearance-|cursor-|transition|duration-|ease-|select-|touch-|will-change|animate-)/
const VARIANT_PREFIX_RE =
  /^(?:sm|md|lg|xl|2xl|hover|focus|active|disabled|checked|before|after|group-hover|focus-visible):/

function numericToken(token: string): number | string | undefined {
  if (token === 'px') return 1
  if (token === 'full') return '100%'
  if (token === 'screen') return '100%'
  if (token === 'auto') return 'auto'
  const arbitrary = token.match(/^\[(-?\d+(?:\.\d+)?)(px|%)?\]$/)
  if (arbitrary) return arbitrary[2] === '%' ? `${arbitrary[1]}%` : Number(arbitrary[1])
  const numeric = Number(token)
  if (Number.isFinite(numeric)) return numeric * 4
  return undefined
}

function arbitraryNumber(token: string): number | undefined {
  const value = numericToken(token)
  return typeof value === 'number' ? value : undefined
}

function colorToken(token: string): string | undefined {
  const [base, opacity] = token.split('/')
  const arbitrary = base.match(/^\[(#[0-9a-fA-F]{3,8})\]$/)
  const color = arbitrary?.[1] ?? COLOR_NAMES[base]
  if (!color || !opacity || color === 'transparent') return color
  const alpha = Math.max(0, Math.min(100, Number(opacity)))
  if (!Number.isFinite(alpha) || !/^#[0-9a-fA-F]{6}$/.test(color)) return color
  return `${color}${Math.round((alpha / 100) * 255)
    .toString(16)
    .padStart(2, '0')}`
}

function addTransform(
  style: Record<string, ExpoStyleValue>,
  transform: Record<string, string | number>
): void {
  const current = style.transform
  const values = Array.isArray(current) ? [...current] : []
  values.push(transform)
  style.transform = values
}

function applySpacing(
  style: Record<string, ExpoStyleValue>,
  prefix: string,
  token: string
): boolean {
  const value = numericToken(token)
  if (value === undefined) return false
  const properties: Readonly<Partial<Record<string, readonly string[]>>> = {
    p: ['padding'],
    px: ['paddingHorizontal'],
    py: ['paddingVertical'],
    pt: ['paddingTop'],
    pr: ['paddingRight'],
    pb: ['paddingBottom'],
    pl: ['paddingLeft'],
    ps: ['paddingStart'],
    pe: ['paddingEnd'],
    m: ['margin'],
    mx: ['marginHorizontal'],
    my: ['marginVertical'],
    mt: ['marginTop'],
    mr: ['marginRight'],
    mb: ['marginBottom'],
    ml: ['marginLeft'],
    ms: ['marginStart'],
    me: ['marginEnd']
  }
  const keys = properties[prefix]
  if (!keys) return false
  for (const key of keys) style[key] = value
  return true
}

function applyDimension(
  style: Record<string, ExpoStyleValue>,
  prefix: string,
  token: string
): boolean {
  const property: Readonly<Partial<Record<string, string>>> = {
    w: 'width',
    h: 'height',
    'min-w': 'minWidth',
    'min-h': 'minHeight',
    'max-w': 'maxWidth',
    'max-h': 'maxHeight',
    top: 'top',
    right: 'right',
    bottom: 'bottom',
    left: 'left'
  }
  const key = property[prefix]
  if (!key) return false
  const value = numericToken(token)
  if (value === undefined) return false
  style[key] = value
  return true
}

function applyLayoutUtility(style: Record<string, ExpoStyleValue>, className: string): boolean {
  const direct: Readonly<Partial<Record<string, readonly [string, string | number]>>> = {
    flex: ['flexDirection', 'row'],
    'flex-row': ['flexDirection', 'row'],
    'flex-row-reverse': ['flexDirection', 'row-reverse'],
    'flex-col': ['flexDirection', 'column'],
    'flex-col-reverse': ['flexDirection', 'column-reverse'],
    'flex-wrap': ['flexWrap', 'wrap'],
    'flex-nowrap': ['flexWrap', 'nowrap'],
    'items-start': ['alignItems', 'flex-start'],
    'items-end': ['alignItems', 'flex-end'],
    'items-center': ['alignItems', 'center'],
    'items-stretch': ['alignItems', 'stretch'],
    'items-baseline': ['alignItems', 'baseline'],
    'justify-start': ['justifyContent', 'flex-start'],
    'justify-end': ['justifyContent', 'flex-end'],
    'justify-center': ['justifyContent', 'center'],
    'justify-between': ['justifyContent', 'space-between'],
    'justify-around': ['justifyContent', 'space-around'],
    'justify-evenly': ['justifyContent', 'space-evenly'],
    'self-start': ['alignSelf', 'flex-start'],
    'self-end': ['alignSelf', 'flex-end'],
    'self-center': ['alignSelf', 'center'],
    'self-stretch': ['alignSelf', 'stretch'],
    absolute: ['position', 'absolute'],
    relative: ['position', 'relative'],
    hidden: ['display', 'none'],
    'overflow-hidden': ['overflow', 'hidden'],
    'overflow-visible': ['overflow', 'visible'],
    'flex-1': ['flex', 1],
    grow: ['flexGrow', 1],
    'grow-0': ['flexGrow', 0],
    shrink: ['flexShrink', 1],
    'shrink-0': ['flexShrink', 0]
  }
  const entry = direct[className]
  if (!entry) return false
  style[entry[0]] = entry[1]
  return true
}

function applyTypography(style: Record<string, ExpoStyleValue>, className: string): boolean {
  if (className === 'italic') {
    style.fontStyle = 'italic'
    return true
  }
  if (className === 'not-italic') {
    style.fontStyle = 'normal'
    return true
  }
  if (className === 'underline' || className === 'line-through') {
    style.textDecorationLine = className
    return true
  }
  const lineHeight = className.match(/^leading-(.+)$/)
  if (lineHeight) {
    const value = numericToken(lineHeight[1])
    if (typeof value !== 'number') return false
    style.lineHeight = value
    return true
  }
  const letterSpacing = className.match(/^tracking-(.+)$/)
  if (letterSpacing) {
    const values: Readonly<Partial<Record<string, number>>> = {
      tighter: -0.8,
      tight: -0.4,
      normal: 0,
      wide: 0.4,
      wider: 0.8,
      widest: 1.6
    }
    const value = values[letterSpacing[1]] ?? arbitraryNumber(letterSpacing[1])
    if (value === undefined) return false
    style.letterSpacing = value
    return true
  }
  const align = className.match(/^text-(left|center|right|justify)$/)
  if (align) {
    style.textAlign = align[1]
    return true
  }
  const font = className.match(/^font-(.+)$/)
  if (font) {
    const weight = FONT_WEIGHTS[font[1]]
    if (weight) style.fontWeight = weight
    else if (/^\[.+\]$/.test(font[1])) style.fontFamily = font[1].slice(1, -1).replaceAll('_', ' ')
    else return false
    return true
  }
  const text = className.match(/^text-(.+)$/)
  if (!text) return false
  const size = TEXT_SIZES[text[1]] ?? arbitraryNumber(text[1])
  if (size !== undefined) {
    style.fontSize = size
    return true
  }
  const color = colorToken(text[1])
  if (!color) return false
  style.color = color
  return true
}

function applyPaint(style: Record<string, ExpoStyleValue>, className: string): boolean {
  const background = className.match(/^bg-(.+)$/)
  if (background) {
    const color = colorToken(background[1])
    if (!color) return false
    style.backgroundColor = color
    return true
  }
  return (
    applyBorder(style, className) ||
    applyRadius(style, className) ||
    applyOpacity(style, className) ||
    applyShadow(style, className)
  )
}

function applyBorder(style: Record<string, ExpoStyleValue>, className: string): boolean {
  if (className === 'border') {
    style.borderWidth = 1
    return true
  }
  if (className === 'border-solid') {
    style.borderStyle = 'solid'
    return true
  }
  if (className === 'border-dashed' || className === 'border-dotted') {
    style.borderStyle = className.slice('border-'.length)
    return true
  }
  const border = className.match(/^border-(.+)$/)
  if (border) {
    const numericWidth = Number(border[1])
    let width: number | undefined
    if (Number.isFinite(numericWidth)) width = numericWidth
    else if (border[1].startsWith('[')) width = arbitraryNumber(border[1])
    if (width !== undefined) style.borderWidth = width
    else {
      const color = colorToken(border[1])
      if (!color) return false
      style.borderColor = color
    }
    return true
  }
  return false
}

function applyRadius(style: Record<string, ExpoStyleValue>, className: string): boolean {
  const rounded = className.match(/^rounded(?:-(.+))?$/)
  if (rounded) {
    const token = rounded[1] ?? 'DEFAULT'
    const radius = nativeBorderRadius(token) ?? arbitraryNumber(token)
    if (radius === undefined) return false
    style.borderRadius = radius
    return true
  }
  return false
}

function applyOpacity(style: Record<string, ExpoStyleValue>, className: string): boolean {
  const opacity = className.match(/^opacity-(\d+)$/)
  if (opacity) {
    style.opacity = Math.max(0, Math.min(100, Number(opacity[1]))) / 100
    return true
  }
  return false
}

function applyShadow(style: Record<string, ExpoStyleValue>, className: string): boolean {
  if (className === 'shadow' || className.startsWith('shadow-')) {
    style.shadowColor = '#000000'
    style.shadowOpacity = className === 'shadow-lg' ? 0.22 : 0.16
    style.shadowRadius = className === 'shadow-lg' ? 8 : 4
    style.elevation = className === 'shadow-lg' ? 8 : 4
    return true
  }
  return false
}

function applyMeasuredUtility(style: Record<string, ExpoStyleValue>, className: string): boolean {
  const match = className.match(
    /^(min-w|min-h|max-w|max-h|w|h|top|right|bottom|left|p[trblxyse]?|m[trblxyse]?|gap|gap-x|gap-y|z)-(.+)$/
  )
  if (!match) return false
  const [, prefix, token] = match
  if (applySpacing(style, prefix, token) || applyDimension(style, prefix, token)) return true
  const value = numericToken(token)
  if (value === undefined || typeof value === 'string') return false
  if (prefix === 'gap') style.gap = value
  else if (prefix === 'gap-x') style.columnGap = value
  else if (prefix === 'gap-y') style.rowGap = value
  else if (prefix === 'z') style.zIndex = value / 4
  else return false
  return true
}

function applyMiscUtility(result: ExpoStyleResult, className: string): boolean {
  const aspect = className.match(/^aspect-\[(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?\]$/)
  if (aspect) {
    const denominator = aspect[2] ? Number(aspect[2]) : 1
    result.style.aspectRatio = Number(aspect[1]) / denominator
    return true
  }
  const rotate = className.match(/^rotate-\[(-?\d+(?:\.\d+)?)deg\]$/)
  if (rotate) {
    addTransform(result.style, { rotate: `${rotate[1]}deg` })
    return true
  }
  const objectFit = className.match(/^object-(cover|contain|fill|none|scale-down)$/)
  if (objectFit) {
    if (objectFit[1] === 'fill') result.resizeMode = 'stretch'
    else if (objectFit[1] === 'none') result.resizeMode = 'center'
    else if (objectFit[1] === 'scale-down') result.resizeMode = 'contain'
    else if (objectFit[1] === 'cover' || objectFit[1] === 'contain') {
      result.resizeMode = objectFit[1]
    }
    return true
  }
  const localAsset = className.match(/^bg-\[url\(\.\/assets\/([^)]+)\)\]$/)
  if (localAsset) {
    result.backgroundAsset = localAsset[1]
    return true
  }
  if (className === 'bg-cover') {
    result.resizeMode = 'cover'
    return true
  }
  if (className === 'bg-contain') {
    result.resizeMode = 'contain'
    return true
  }
  if (className === 'bg-repeat') {
    result.resizeMode = 'repeat'
    return true
  }
  if (className === 'bg-center' || className === 'bg-no-repeat') return true
  const placeholder = className.match(/^placeholder:text-(.+)$/)
  if (placeholder) {
    result.placeholderTextColor = colorToken(placeholder[1])
    return result.placeholderTextColor !== undefined
  }
  return false
}

export function translateExpoStyle(
  className: string,
  sourceId: string,
  warn: ExpoWarningSink
): ExpoStyleResult {
  const result: ExpoStyleResult = { style: {} }
  for (const utility of className.split(/\s+/).filter(Boolean)) {
    if (VARIANT_PREFIX_RE.test(utility)) {
      warn({
        code: 'expo-style-variant-unsupported',
        message: `Expo target dropped state/responsive Tailwind utility ${JSON.stringify(utility)}`,
        nodeId: sourceId
      })
      continue
    }
    if (WEB_ONLY_UTILITY_RE.test(utility)) {
      warn({
        code: 'expo-style-web-only',
        message: `Expo target dropped web-only Tailwind utility ${JSON.stringify(utility)}`,
        nodeId: sourceId
      })
      continue
    }
    if (
      applyLayoutUtility(result.style, utility) ||
      applyMeasuredUtility(result.style, utility) ||
      applyTypography(result.style, utility) ||
      applyPaint(result.style, utility) ||
      applyMiscUtility(result, utility)
    ) {
      continue
    }
    warn({
      code: 'expo-style-unsupported',
      message: `Expo target could not translate Tailwind utility ${JSON.stringify(utility)}`,
      nodeId: sourceId
    })
  }
  return result
}
