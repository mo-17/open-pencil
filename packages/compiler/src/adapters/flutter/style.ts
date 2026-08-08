import { nativeBorderRadius } from '../native-shared'
import { dartString } from './names'
import type { FlutterEdges, FlutterStyle, FlutterWarningSink } from './types'

const NAMED_COLORS = new Map<string, string>([
  ['transparent', '#00000000'],
  ['black', '#000000'],
  ['white', '#ffffff'],
  ['background', '#ffffff'],
  ['foreground', '#111827'],
  ['primary', '#2563eb'],
  ['primary-foreground', '#ffffff'],
  ['secondary', '#e5e7eb'],
  ['secondary-foreground', '#111827'],
  ['muted', '#f3f4f6'],
  ['muted-foreground', '#6b7280'],
  ['border', '#d1d5db'],
  ['destructive', '#ef4444'],
  ['gray-100', '#f3f4f6'],
  ['gray-300', '#d1d5db'],
  ['gray-500', '#6b7280'],
  ['gray-700', '#374151'],
  ['gray-900', '#111827'],
  ['blue-500', '#3b82f6'],
  ['blue-600', '#2563eb'],
  ['red-500', '#ef4444'],
  ['green-500', '#22c55e'],
  ['yellow-500', '#eab308']
])

const TEXT_SIZES = new Map<string, number>([
  ['xs', 12],
  ['sm', 14],
  ['base', 16],
  ['lg', 18],
  ['xl', 20],
  ['2xl', 24],
  ['3xl', 30],
  ['4xl', 36],
  ['5xl', 48],
  ['6xl', 60],
  ['7xl', 72],
  ['8xl', 96],
  ['9xl', 128]
])

const FONT_WEIGHTS: Readonly<Record<string, number>> = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900
}

const VARIANT_PREFIX =
  /^(?:sm|md|lg|xl|2xl|hover|focus|active|disabled|checked|before|after|group-hover|focus-visible):/
const WEB_ONLY =
  /^(?:appearance-|cursor-|transition|duration-|ease-|select-|touch-|will-change|animate-)/

export function translateFlutterStyle(
  className: string,
  sourceId: string,
  warn: FlutterWarningSink
): FlutterStyle {
  const style: FlutterStyle = {}
  for (const utility of className.split(/\s+/).filter(Boolean)) {
    if (utility === 'items-baseline') {
      warn({
        code: 'flutter-style-baseline-unsupported',
        message:
          'Flutter dropped items-baseline because generated mixed-axis layouts cannot guarantee a TextBaseline',
        nodeId: sourceId
      })
      continue
    }
    if (VARIANT_PREFIX.test(utility)) {
      warnUnsupported('flutter-style-variant-unsupported', utility, sourceId, warn)
      continue
    }
    if (WEB_ONLY.test(utility)) {
      warnUnsupported('flutter-style-web-only', utility, sourceId, warn)
      continue
    }
    if (
      applyLayout(style, utility) ||
      applyMeasured(style, utility, sourceId, warn) ||
      applyTypography(style, utility, sourceId, warn) ||
      applyPaint(style, utility, sourceId, warn) ||
      applyImage(style, utility)
    ) {
      continue
    }
    warnUnsupported('flutter-style-unsupported', utility, sourceId, warn)
  }
  normalizeConstraints(style, sourceId, warn)
  return style
}

export function flutterColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = normalizeHex(value)
  if (!normalized) return undefined
  return `const Color(0x${normalized})`
}

export function edgeInsets(edges: FlutterEdges | undefined): string | undefined {
  if (!edges) return undefined
  const top = edges.top ?? 0
  const right = edges.right ?? 0
  const bottom = edges.bottom ?? 0
  const left = edges.left ?? 0
  if (top === right && right === bottom && bottom === left) {
    return `const EdgeInsets.all(${dartNumber(top)})`
  }
  if (top === bottom && right === left) {
    return `const EdgeInsets.symmetric(horizontal: ${dartNumber(left)}, vertical: ${dartNumber(top)})`
  }
  return `const EdgeInsets.fromLTRB(${dartNumber(left)}, ${dartNumber(top)}, ${dartNumber(right)}, ${dartNumber(bottom)})`
}

export function textStyle(style: FlutterStyle): string | undefined {
  const entries = [
    style.color ? `color: ${flutterColor(style.color)}` : '',
    style.fontSize !== undefined ? `fontSize: ${dartNumber(style.fontSize)}` : '',
    style.fontWeight !== undefined ? `fontWeight: FontWeight.w${style.fontWeight}` : '',
    style.fontFamily ? `fontFamily: ${dartString(style.fontFamily)}` : '',
    style.fontStyle ? `fontStyle: FontStyle.${style.fontStyle}` : '',
    style.letterSpacing !== undefined ? `letterSpacing: ${dartNumber(style.letterSpacing)}` : '',
    style.lineHeight !== undefined
      ? `height: ${dartNumber(style.lineHeight / (style.fontSize ?? 16))}`
      : ''
  ].filter(Boolean)
  return entries.length > 0 ? `TextStyle(${entries.join(', ')})` : undefined
}

export function textAlign(style: FlutterStyle): string | undefined {
  return style.textAlign ? `TextAlign.${style.textAlign}` : undefined
}

export function boxDecoration(style: FlutterStyle, assetPrefix: string): string | undefined {
  const image = style.backgroundAsset
    ? `image: DecorationImage(image: AssetImage(${dartString(`${assetPrefix}${style.backgroundAsset}`)}), fit: ${boxFit(style.imageFit)}),`
    : ''
  const entries = [
    style.backgroundColor ? `color: ${flutterColor(style.backgroundColor)}` : '',
    style.borderRadius !== undefined
      ? `borderRadius: BorderRadius.circular(${dartNumber(style.borderRadius)})`
      : '',
    style.borderWidth !== undefined || style.borderColor
      ? `border: Border.all(color: ${flutterColor(style.borderColor ?? '#000000')}, width: ${dartNumber(style.borderWidth ?? 1)})`
      : '',
    image
  ].filter(Boolean)
  return entries.length > 0 ? `BoxDecoration(${entries.join(', ')})` : undefined
}

export function boxConstraints(style: FlutterStyle): string | undefined {
  const entries = [
    style.minWidth !== undefined ? `minWidth: ${dartNumber(style.minWidth)}` : '',
    style.minHeight !== undefined ? `minHeight: ${dartNumber(style.minHeight)}` : '',
    style.maxWidth !== undefined ? `maxWidth: ${dartNumber(style.maxWidth)}` : '',
    style.maxHeight !== undefined ? `maxHeight: ${dartNumber(style.maxHeight)}` : ''
  ].filter(Boolean)
  return entries.length > 0 ? `BoxConstraints(${entries.join(', ')})` : undefined
}

export function boxFit(value: FlutterStyle['imageFit']): string {
  if (value === 'contain') return 'BoxFit.contain'
  if (value === 'fill') return 'BoxFit.fill'
  if (value === 'none') return 'BoxFit.none'
  if (value === 'scaleDown') return 'BoxFit.scaleDown'
  return 'BoxFit.cover'
}

function applyLayout(style: FlutterStyle, utility: string): boolean {
  if (utility === 'absolute') {
    style.position = 'absolute'
    return true
  }
  const direction: Readonly<Record<string, FlutterStyle['flexDirection']>> = {
    flex: 'row',
    'flex-row': 'row',
    'flex-col': 'column'
  }
  if (direction[utility]) {
    style.flexDirection = direction[utility]
    return true
  }
  const main = utility.match(/^justify-(start|end|center|between|around|evenly)$/)?.[1]
  if (main) {
    const alignments: Readonly<Record<string, NonNullable<FlutterStyle['mainAxisAlignment']>>> = {
      start: 'start',
      end: 'end',
      center: 'center',
      between: 'spaceBetween',
      around: 'spaceAround',
      evenly: 'spaceEvenly'
    }
    style.mainAxisAlignment = alignments[main]
    return true
  }
  const cross = utility.match(/^items-(start|end|center|stretch|baseline)$/)?.[1]
  if (cross) {
    style.crossAxisAlignment = cross as FlutterStyle['crossAxisAlignment']
    return true
  }
  if (utility === 'hidden') {
    style.width = 0
    style.height = 0
    return true
  }
  return false
}

function applyMeasured(
  style: FlutterStyle,
  utility: string,
  sourceId: string,
  warn: FlutterWarningSink
): boolean {
  const match = utility.match(
    /^(min-w|min-h|max-w|max-h|w|h|left|top|right|bottom|p[trblxyse]?|m[trblxyse]?|gap|gap-x|gap-y)-(.+)$/
  )
  if (!match) return false
  const value = numericToken(match[2])
  if (value === undefined) return false
  const property: Readonly<Partial<Record<string, keyof FlutterStyle>>> = {
    w: 'width',
    h: 'height',
    'min-w': 'minWidth',
    'min-h': 'minHeight',
    'max-w': 'maxWidth',
    'max-h': 'maxHeight',
    left: 'left',
    top: 'top',
    right: 'right',
    bottom: 'bottom'
  }
  const direct = property[match[1]]
  if (direct) {
    const positioned = ['left', 'top', 'right', 'bottom'].includes(String(direct))
    const safeValue = positioned ? value : nonNegative(value, utility, sourceId, warn)
    if (direct === 'width') style.width = safeValue
    else if (direct === 'height') style.height = safeValue
    else if (direct === 'minWidth') style.minWidth = safeValue
    else if (direct === 'minHeight') style.minHeight = safeValue
    else if (direct === 'maxWidth') style.maxWidth = safeValue
    else if (direct === 'maxHeight') style.maxHeight = safeValue
    else if (direct === 'left') style.left = value
    else if (direct === 'top') style.top = value
    else if (direct === 'right') style.right = value
    else style.bottom = value
    return true
  }
  if (match[1].startsWith('p')) {
    style.padding = updateEdges(
      style.padding,
      match[1].slice(1),
      nonNegative(value, utility, sourceId, warn)
    )
    return true
  }
  if (match[1].startsWith('m')) {
    style.margin = updateEdges(
      style.margin,
      match[1].slice(1),
      nonNegative(value, utility, sourceId, warn)
    )
    return true
  }
  style.gap = nonNegative(value, utility, sourceId, warn)
  return true
}

function applyTypography(
  style: FlutterStyle,
  utility: string,
  sourceId: string,
  warn: FlutterWarningSink
): boolean {
  return (
    applyFontTypography(style, utility, sourceId, warn) ||
    applyTextTypography(style, utility, sourceId, warn)
  )
}

function applyFontTypography(
  style: FlutterStyle,
  utility: string,
  sourceId: string,
  warn: FlutterWarningSink
): boolean {
  if (utility === 'italic' || utility === 'not-italic') {
    style.fontStyle = utility === 'italic' ? 'italic' : 'normal'
    return true
  }
  const weight = utility.match(/^font-(.+)$/)?.[1]
  if (weight && FONT_WEIGHTS[weight]) {
    style.fontWeight = FONT_WEIGHTS[weight]
    return true
  }
  const family = utility.match(/^font-\[(.+)\]$/)?.[1]
  if (family) {
    style.fontFamily = family.replaceAll('_', ' ')
    return true
  }
  const leading = utility.match(/^leading-(.+)$/)?.[1]
  if (leading) {
    const value = numericToken(leading)
    if (value === undefined) return false
    style.lineHeight = nonNegative(value, utility, sourceId, warn)
    return true
  }
  const tracking = utility.match(/^tracking-\[(-?\d+(?:\.\d+)?)px\]$/)?.[1]
  if (tracking) {
    style.letterSpacing = Number(tracking)
    return true
  }
  return false
}

function applyTextTypography(
  style: FlutterStyle,
  utility: string,
  sourceId: string,
  warn: FlutterWarningSink
): boolean {
  const align = utility.match(/^text-(left|center|right|justify)$/)?.[1]
  if (align) {
    style.textAlign = align as FlutterStyle['textAlign']
    return true
  }
  const text = utility.match(/^text-(.+)$/)?.[1]
  if (!text) return false
  const size = TEXT_SIZES.get(text) ?? numericToken(text)
  if (size !== undefined) {
    style.fontSize = nonNegative(size, utility, sourceId, warn)
    return true
  }
  const color = colorToken(text)
  if (!color) return false
  style.color = color
  return true
}

function applyPaint(
  style: FlutterStyle,
  utility: string,
  sourceId: string,
  warn: FlutterWarningSink
): boolean {
  const background = utility.match(/^bg-(.+)$/)?.[1]
  if (background) {
    const color = colorToken(background)
    if (!color) return false
    style.backgroundColor = color
    return true
  }
  if (utility === 'border') {
    style.borderWidth = 1
    return true
  }
  if (utility === 'border-solid') return true
  const border = utility.match(/^border-(.+)$/)?.[1]
  if (border) {
    let width: number | undefined
    if (/^\d+(?:\.\d+)?$/.test(border)) width = Number(border)
    else if (border.startsWith('[')) width = numericToken(border)
    if (width !== undefined) style.borderWidth = nonNegative(width, utility, sourceId, warn)
    else {
      const color = colorToken(border)
      if (!color) return false
      style.borderColor = color
    }
    return true
  }
  const rounded =
    utility.match(/^rounded(?:-(.+))?$/)?.[1] ?? (utility === 'rounded' ? 'DEFAULT' : undefined)
  if (rounded) {
    const radius = nativeBorderRadius(rounded) ?? numericToken(rounded)
    if (radius === undefined) return false
    style.borderRadius = nonNegative(radius, utility, sourceId, warn)
    return true
  }
  const opacity = utility.match(/^opacity-(\d+)$/)?.[1]
  if (opacity) {
    style.opacity = Math.max(0, Math.min(100, Number(opacity))) / 100
    return true
  }
  return false
}

function applyImage(style: FlutterStyle, utility: string): boolean {
  const asset = utility.match(/^bg-\[url\(\.\/assets\/([^/\\)]+)\)\]$/)?.[1]
  if (asset) {
    style.backgroundAsset = asset
    return true
  }
  const fit = utility.match(/^object-(cover|contain|fill|none|scale-down)$/)?.[1]
  if (fit) {
    style.imageFit = fit === 'scale-down' ? 'scaleDown' : (fit as FlutterStyle['imageFit'])
    return true
  }
  const placeholder = utility.match(/^placeholder:text-(.+)$/)?.[1]
  if (placeholder) {
    style.placeholderColor = colorToken(placeholder)
    return style.placeholderColor !== undefined
  }
  return ['bg-cover', 'bg-contain', 'bg-center', 'bg-no-repeat'].includes(utility)
}

function updateEdges(
  existing: FlutterEdges | undefined,
  suffix: string,
  value: number
): FlutterEdges {
  const edges = { ...existing }
  const keys: Readonly<Record<string, readonly (keyof FlutterEdges)[]>> = {
    '': ['top', 'right', 'bottom', 'left'],
    x: ['left', 'right'],
    y: ['top', 'bottom'],
    t: ['top'],
    r: ['right'],
    b: ['bottom'],
    l: ['left'],
    s: ['left'],
    e: ['right']
  }
  for (const key of keys[suffix] ?? []) edges[key] = value
  return edges
}

function numericToken(token: string): number | undefined {
  if (token === 'px') return 1
  const arbitrary = token.match(/^\[(-?\d+(?:\.\d+)?)(?:px)?\]$/)?.[1]
  if (arbitrary !== undefined) return Number(arbitrary)
  const numeric = Number(token)
  return Number.isFinite(numeric) ? numeric * 4 : undefined
}

function colorToken(token: string): string | undefined {
  const base = token.split('/')[0]
  return (
    base.match(/^\[(#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})\]$/)?.[1] ??
    NAMED_COLORS.get(base)
  )
}

function normalizeHex(value: string): string | undefined {
  const hex = value.replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3,8}$/.test(hex)) return undefined
  if (hex.length === 3) {
    return `FF${hex.charAt(0).repeat(2)}${hex.charAt(1).repeat(2)}${hex.charAt(2).repeat(2)}`.toUpperCase()
  }
  if (hex.length === 4) {
    const r = hex.charAt(0).repeat(2)
    const g = hex.charAt(1).repeat(2)
    const b = hex.charAt(2).repeat(2)
    const a = hex.charAt(3).repeat(2)
    return `${a}${r}${g}${b}`.toUpperCase()
  }
  if (hex.length === 6) return `FF${hex}`.toUpperCase()
  if (hex.length === 8) return `${hex.slice(6)}${hex.slice(0, 6)}`.toUpperCase()
  return undefined
}

function warnUnsupported(
  code: string,
  utility: string,
  sourceId: string,
  warn: FlutterWarningSink
): void {
  warn({
    code,
    message: `Flutter target could not translate Tailwind utility ${JSON.stringify(utility)}`,
    nodeId: sourceId
  })
}

function nonNegative(
  value: number,
  utility: string,
  sourceId: string,
  warn: FlutterWarningSink
): number {
  if (value >= 0) return value
  warn({
    code: 'flutter-style-negative-constraint-clamped',
    message: `Flutter clamped negative numeric utility ${JSON.stringify(utility)} to zero`,
    nodeId: sourceId
  })
  return 0
}

function normalizeConstraints(
  style: FlutterStyle,
  sourceId: string,
  warn: FlutterWarningSink
): void {
  if (
    style.minWidth !== undefined &&
    style.maxWidth !== undefined &&
    style.maxWidth < style.minWidth
  ) {
    style.maxWidth = style.minWidth
    warn({
      code: 'flutter-style-constraint-normalized',
      message: 'Flutter raised maxWidth to minWidth to avoid an invalid BoxConstraints assertion',
      nodeId: sourceId
    })
  }
  if (
    style.minHeight !== undefined &&
    style.maxHeight !== undefined &&
    style.maxHeight < style.minHeight
  ) {
    style.maxHeight = style.minHeight
    warn({
      code: 'flutter-style-constraint-normalized',
      message: 'Flutter raised maxHeight to minHeight to avoid an invalid BoxConstraints assertion',
      nodeId: sourceId
    })
  }
}

function dartNumber(value: number): string {
  if (!Number.isFinite(value)) return '0.0'
  return Number.isInteger(value) ? `${value}.0` : String(value)
}
