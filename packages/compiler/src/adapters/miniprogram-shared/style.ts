import type { IRStyleAttr } from '#compiler/ir/types'

import { nativeBorderRadius, nativeTextSize } from '../native-shared'
import type { MiniProgramStyleResult } from './types'

const COLOR_NAMES: Readonly<Partial<Record<string, string>>> = {
  transparent: 'transparent',
  black: '#000000',
  white: '#ffffff',
  background: '#ffffff',
  foreground: '#111827',
  primary: '#2563eb',
  'primary-foreground': '#ffffff',
  secondary: '#e5e7eb',
  'secondary-foreground': '#111827',
  muted: '#f3f4f6',
  'muted-foreground': '#6b7280',
  border: '#d1d5db',
  destructive: '#ef4444',
  'destructive-foreground': '#ffffff'
}
const UNSAFE_CSS_SOURCE =
  /(?:@import|expression\s*\(|javascript:|data:|file:|https?:|url\s*\(|\/(?:Users|home|private|var|tmp)\/|[A-Za-z]:[\\/])/i
const UNSAFE_CSS_SYNTAX = /[\\<>{};]/
const MAX_INLINE_CSS_VALUE_LENGTH = 1024
const SAFE_INLINE_PROPERTIES = new Set([
  'backgroundColor',
  'borderColor',
  'borderRadius',
  'borderWidth',
  'color',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'height',
  'letterSpacing',
  'lineHeight',
  'margin',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginTop',
  'maxHeight',
  'maxWidth',
  'minHeight',
  'minWidth',
  'opacity',
  'padding',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'textAlign',
  'width'
])

export function translateMiniProgramStyle(
  className: string,
  styleAttr?: IRStyleAttr
): MiniProgramStyleResult {
  const declarations: Record<string, string> = {}
  const unsupportedUtilities: string[] = []
  let backgroundAsset: string | undefined
  for (const utility of className.split(/\s+/).filter(Boolean)) {
    const localAsset = /^bg-\[url\(\.\/assets\/([^/\\)]+)\)\]$/.exec(utility)?.[1]
    if (localAsset) {
      backgroundAsset = localAsset
      continue
    }
    if (!applyUtility(declarations, utility)) unsupportedUtilities.push(utility)
  }
  for (const [property, value] of Object.entries(styleAttr?.declarations ?? {})) {
    if (!SAFE_INLINE_PROPERTIES.has(property) || isUnsafeCSSValue(value)) {
      unsupportedUtilities.push(`style:${property}`)
      continue
    }
    declarations[toKebabCase(property)] = value
  }
  return { declarations, unsupportedUtilities, ...(backgroundAsset ? { backgroundAsset } : {}) }
}

export function emitMiniProgramCSSDeclarations(
  declarations: Readonly<Record<string, string>>
): string {
  return Object.entries(declarations)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([property, value]) => `${property}: ${value};`)
    .join(' ')
}

function applyUtility(style: Record<string, string>, utility: string): boolean {
  const direct: Readonly<Partial<Record<string, readonly [string, string]>>> = {
    flex: ['display', 'flex'],
    'flex-row': ['flex-direction', 'row'],
    'flex-col': ['flex-direction', 'column'],
    'flex-wrap': ['flex-wrap', 'wrap'],
    'items-start': ['align-items', 'flex-start'],
    'items-end': ['align-items', 'flex-end'],
    'items-center': ['align-items', 'center'],
    'items-stretch': ['align-items', 'stretch'],
    'justify-start': ['justify-content', 'flex-start'],
    'justify-end': ['justify-content', 'flex-end'],
    'justify-center': ['justify-content', 'center'],
    'justify-between': ['justify-content', 'space-between'],
    'justify-around': ['justify-content', 'space-around'],
    absolute: ['position', 'absolute'],
    relative: ['position', 'relative'],
    hidden: ['display', 'none'],
    'overflow-hidden': ['overflow', 'hidden'],
    'font-bold': ['font-weight', '700'],
    'font-semibold': ['font-weight', '600'],
    'font-medium': ['font-weight', '500'],
    'font-normal': ['font-weight', '400'],
    italic: ['font-style', 'italic'],
    underline: ['text-decoration', 'underline'],
    'bg-cover': ['background-size', 'cover'],
    'bg-contain': ['background-size', 'contain'],
    'bg-center': ['background-position', 'center'],
    'bg-no-repeat': ['background-repeat', 'no-repeat'],
    'bg-repeat': ['background-repeat', 'repeat']
  }
  const entry = direct[utility]
  if (entry) {
    style[entry[0]] = entry[1]
    return true
  }
  const spacing = /^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap)-(.+)$/.exec(utility)
  if (spacing) return applySpacing(style, spacing[1], spacing[2])
  const dimension = /^(w|h|min-w|min-h|max-w|max-h|top|right|bottom|left)-(.+)$/.exec(utility)
  if (dimension) return applyDimension(style, dimension[1], dimension[2])
  const text = /^text-(.+)$/.exec(utility)?.[1]
  if (text) {
    const size = nativeTextSize(text)
    const color = colorToken(text)
    if (size) style['font-size'] = `${size}px`
    else if (color) style.color = color
    else return false
    return true
  }
  const background = /^bg-(.+)$/.exec(utility)?.[1]
  if (background) {
    const color = colorToken(background)
    if (!color) return false
    style['background-color'] = color
    return true
  }
  const rounded = /^rounded(?:-(.+))?$/.exec(utility)
  if (rounded) {
    const radius = nativeBorderRadius(rounded[1] ?? 'DEFAULT')
    if (radius === undefined) return false
    style['border-radius'] = `${radius}px`
    return true
  }
  const opacity = /^opacity-(\d+)$/.exec(utility)?.[1]
  if (opacity) {
    const value = Number(opacity)
    if (value < 0 || value > 100) return false
    style.opacity = String(value / 100)
    return true
  }
  return false
}

function applySpacing(style: Record<string, string>, prefix: string, token: string): boolean {
  const value = numericToken(token)
  if (!value) return false
  const properties: Readonly<Partial<Record<string, readonly string[]>>> = {
    p: ['padding'],
    px: ['padding-left', 'padding-right'],
    py: ['padding-top', 'padding-bottom'],
    pt: ['padding-top'],
    pr: ['padding-right'],
    pb: ['padding-bottom'],
    pl: ['padding-left'],
    m: ['margin'],
    mx: ['margin-left', 'margin-right'],
    my: ['margin-top', 'margin-bottom'],
    mt: ['margin-top'],
    mr: ['margin-right'],
    mb: ['margin-bottom'],
    ml: ['margin-left'],
    gap: ['gap']
  }
  const names = properties[prefix]
  if (!names) return false
  for (const name of names) style[name] = value
  return true
}

function applyDimension(style: Record<string, string>, prefix: string, token: string): boolean {
  const property: Readonly<Partial<Record<string, string>>> = {
    w: 'width',
    h: 'height',
    'min-w': 'min-width',
    'min-h': 'min-height',
    'max-w': 'max-width',
    'max-h': 'max-height',
    top: 'top',
    right: 'right',
    bottom: 'bottom',
    left: 'left'
  }
  const name = property[prefix]
  const value = numericToken(token)
  if (!name || !value) return false
  style[name] = value
  return true
}

function numericToken(token: string): string | undefined {
  if (token === 'px') return '1px'
  if (token === 'full' || token === 'screen') return '100%'
  if (token === 'auto') return 'auto'
  const arbitrary = /^\[(-?\d+(?:\.\d+)?)(px|rpx|%)?\]$/.exec(token)
  if (arbitrary) return `${arbitrary[1]}${arbitrary[2] ?? 'px'}`
  const numeric = Number(token)
  return Number.isFinite(numeric) ? `${numeric * 4}px` : undefined
}

function colorToken(token: string): string | undefined {
  const arbitrary = /^\[(#[0-9a-fA-F]{3,8})\]$/.exec(token)?.[1]
  return arbitrary?.toLowerCase() ?? COLOR_NAMES[token]
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

function isUnsafeCSSValue(value: string): boolean {
  if (
    value.length > MAX_INLINE_CSS_VALUE_LENGTH ||
    UNSAFE_CSS_SOURCE.test(value) ||
    UNSAFE_CSS_SYNTAX.test(value)
  ) {
    return true
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 31 || code === 127) return true
  }
  return false
}
