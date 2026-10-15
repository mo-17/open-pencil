import { colorToCSS, parseColor, tryParseColor } from '@open-pencil/scene-graph/color'
import { parseCSSNumber, splitCSSValue } from '@open-pencil/scene-graph/css'

import type { DesignDocument, DesignElement, DesignNode, DesignStyleDeclaration } from '../types'
import { parseCSSRules, type ParsedCSSRule } from './css-rules'

interface HeadlessCSSRule {
  selector: string
  specificity: number
  order: number
  style: DesignStyleDeclaration
}

interface ParsedHeadlessCSS {
  rules: HeadlessCSSRule[]
  customProperties: DesignStyleDeclaration
}

interface AncestorContext {
  element: DesignElement
  parent: AncestorContext | null
}

const INHERITED_PROPERTIES = new Set([
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height'
])

function parseRules(cssText: string): ParsedHeadlessCSS {
  let order = 0
  const initialStyleRules = parseCSSRules(cssText)
  const initialCustomProperties = customPropertiesOf(initialStyleRules)
  const normalizedCSSText = normalizeUnsupportedCSSValues(cssText, initialCustomProperties)
  const styleRules =
    normalizedCSSText === cssText ? initialStyleRules : parseCSSRules(normalizedCSSText)
  const customProperties = customPropertiesOf(styleRules)
  const rules = styleRules.flatMap((rule) => {
    const style = expandStyleShorthands(
      Object.fromEntries(
        Object.entries(rule.style).map(([key, value]) => [
          key,
          resolveCSSValue(value, customProperties)
        ])
      )
    )
    return rule.selectorText
      .split(',')
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0)
      .map((selector) => ({
        selector,
        specificity: selectorSpecificity(selector),
        order: order++,
        style
      }))
  })
  return { rules, customProperties }
}

function normalizeUnsupportedCSSValues(
  cssText: string,
  customProperties: DesignStyleDeclaration
): string {
  const withVariables = resolveCSSVariables(cssText, customProperties)
  const withLegacyColors = withVariables.replaceAll(
    /oklch\(\s*[\d.]+%\s+[\d.]+\s+[\d.]+(?:\s*\/\s*[\d.]+%?)?\s*\)/gi,
    (value) => colorToCSS(parseColor(value))
  )
  return withLegacyColors.replaceAll(
    /calc\(\s*(-?(?:\d+(?:\.\d+)?|\.\d+))([a-z]+|%)?\s*\*\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*\)/gi,
    (_, base: string, unit: string | undefined, multiplier: string) => {
      const product = Number(base) * Number(multiplier)
      const normalized = Object.is(product, -0) ? 0 : product
      return unit?.toLowerCase() === 'rem' ? `${normalized * 16}px` : `${normalized}${unit ?? ''}`
    }
  )
}

function resolveCSSVariables(
  value: string,
  customProperties: DesignStyleDeclaration,
  resolving = new Set<string>()
): string {
  let output = ''
  let cursor = 0
  while (cursor < value.length) {
    const start = value.indexOf('var(', cursor)
    if (start === -1) return output + value.slice(cursor)
    output += value.slice(cursor, start)
    const end = matchingParenIndex(value, start + 3)
    if (end < 0) return output + value.slice(start)

    const expression = value.slice(start, end + 1)
    const [rawName, fallback] = splitCSSVarArguments(value.slice(start + 4, end))
    const name = rawName.trim()
    if (Object.hasOwn(customProperties, name) && !resolving.has(name)) {
      const nextResolving = new Set(resolving).add(name)
      output += resolveCSSVariables(customProperties[name], customProperties, nextResolving)
    } else if (fallback !== undefined) {
      output += resolveCSSVariables(fallback.trim(), customProperties, resolving)
    } else {
      output += expression
    }
    cursor = end + 1
  }
  return output
}

function matchingParenIndex(value: string, openIndex: number): number {
  let depth = 0
  for (let index = openIndex; index < value.length; index++) {
    if (value[index] === '(') depth++
    else if (value[index] === ')' && --depth === 0) return index
  }
  return -1
}

function splitCSSVarArguments(value: string): [string, string?] {
  let depth = 0
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '(') depth++
    else if (value[index] === ')') depth--
    else if (value[index] === ',' && depth === 0) {
      return [value.slice(0, index), value.slice(index + 1)]
    }
  }
  return [value]
}

function resolveCSSValue(value: string, customProperties: DesignStyleDeclaration): string {
  const withVariables = value.replaceAll(/var\((--[\w-]+)(?:,[^)]+)?\)/g, (_, name: string) => {
    return customProperties[name] ?? ''
  })
  return resolveSimpleCalc(withVariables)
}

function resolveSimpleCalc(value: string): string {
  const calc = value.match(/^calc\(([-\d.]+)(rem|px)?\s*\*\s*([-\d.]+)\)$/)
  if (!calc?.[1] || !calc[3]) return value

  const base = Number.parseFloat(calc[1])
  const multiplier = Number.parseFloat(calc[3])
  const unit = calc[2] ?? 'px'
  if (!Number.isFinite(base) || !Number.isFinite(multiplier)) return value
  return `${unit === 'rem' ? base * multiplier * 16 : base * multiplier}px`
}

const BORDER_STYLES = new Set([
  'none',
  'hidden',
  'dotted',
  'dashed',
  'solid',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset'
])

/**
 * Shorthands as the longhands they set, in declaration order, so a later declaration wins over
 * an earlier one whether it is a shorthand, a logical side, or a single side, as in CSS.
 */
function expandStyleShorthands(style: DesignStyleDeclaration): DesignStyleDeclaration {
  const result: DesignStyleDeclaration = {}
  for (const [property, value] of Object.entries(style)) {
    result[property] = value
    Object.assign(result, longhandsOf(property, value))
  }
  return result
}

function longhandsOf(property: string, value: string): DesignStyleDeclaration {
  if (property === 'margin' || property === 'padding') return boxSides(property, value)
  const logical = /^(margin|padding)-(inline|block)$/u.exec(property)
  if (logical) return logicalSides(property, value, logical[2] === 'inline')
  if (property === 'border') return borderLonghands(value)
  if (property === 'background') {
    const color = splitCSSValue(value).find(isColor)
    return color ? { 'background-color': color } : {}
  }
  return {}
}

function boxSides(property: string, value: string): DesignStyleDeclaration {
  const [top, right = top, bottom = top, left = right] = splitCSSValue(value)
  if (!top || !right || !bottom || !left) return {}
  return {
    [`${property}-top`]: top,
    [`${property}-right`]: right,
    [`${property}-bottom`]: bottom,
    [`${property}-left`]: left
  }
}

/** `padding-inline` and `padding-block` as the sides they set in left-to-right, horizontal text. */
function logicalSides(property: string, value: string, inline: boolean): DesignStyleDeclaration {
  const box = property.slice(0, property.lastIndexOf('-'))
  const [first, second = first] = splitCSSValue(value)
  if (!first || !second) return {}
  const [start, end] = inline ? ['left', 'right'] : ['top', 'bottom']
  return { [`${box}-${start}`]: first, [`${box}-${end}`]: second }
}

function borderLonghands(value: string): DesignStyleDeclaration {
  const parts = splitCSSValue(value)
  const longhands: DesignStyleDeclaration = {}
  const color = parts.find(isColor)
  const width = parts.find((part) => parseCSSNumber(part) !== null)
  const style = parts.find((part) => BORDER_STYLES.has(part.toLowerCase()))
  if (color) longhands['border-color'] = color
  if (width) longhands['border-width'] = width
  if (style) longhands['border-style'] = style.toLowerCase()
  return longhands
}

/** Any CSS color, including `transparent`, which a shorthand may set on purpose. */
function isColor(value: string): boolean {
  return tryParseColor(value) !== null
}

function classList(element: DesignElement): Set<string> {
  const className = 'class' in element.attrs ? element.attrs.class : ''
  return new Set(className.split(/\s+/).filter((name) => name.length > 0))
}

function elementId(element: DesignElement): string | undefined {
  return 'id' in element.attrs ? element.attrs.id : undefined
}

function selectorSpecificity(selector: string): number {
  const idCount = selector.match(/#[\w-]+/g)?.length ?? 0
  const classCount = selector.match(/\.[\w-]+/g)?.length ?? 0
  // A tag counts once per compound; the universal selector, alone or as in `*.card`, counts zero.
  const tagCount = selector.split(/[\s>]+/).filter((part) => /^[a-z]/iu.test(part)).length
  return idCount * 100 + classCount * 10 + tagCount
}

function matchesSimpleSelector(element: DesignElement, selector: string): boolean {
  if (selector.includes(':') || selector.includes('[')) return false

  const idMatch = selector.match(/#([\w-]+)/)
  if (idMatch?.[1] && elementId(element) !== idMatch[1]) return false

  const classes = selector.match(/\.[\w-]+/g) ?? []
  const elementClasses = classList(element)
  if (!classes.every((name) => elementClasses.has(name.slice(1)))) return false

  const tag = selector.replace(/#[\w-]+/g, '').replace(/\.[\w-]+/g, '')
  // The universal selector, as Tailwind's preflight uses for `box-sizing`, matches any element.
  return tag.length === 0 || tag === '*' || element.tagName.toLowerCase() === tag.toLowerCase()
}

function matchesSelector(
  element: DesignElement,
  selector: string,
  parent: AncestorContext | null
): boolean {
  const childParts = selector.split('>').map((part) => part.trim())
  if (childParts.length > 1) return matchesChildSelector(element, childParts, parent)

  const descendantParts = selector.split(/\s+/).filter((part) => part.length > 0)
  if (descendantParts.length > 1) return matchesDescendantSelector(element, descendantParts, parent)

  return matchesSimpleSelector(element, selector)
}

function matchesSelectorParts(
  element: DesignElement,
  parts: string[],
  parent: AncestorContext | null,
  directParentOnly: boolean
): boolean {
  const current = parts.at(-1)
  if (!current || !matchesSimpleSelector(element, current)) return false

  let ancestor = parent
  for (const selector of parts.slice(0, -1).reverse()) {
    if (!directParentOnly) {
      while (ancestor && !matchesSimpleSelector(ancestor.element, selector)) {
        ancestor = ancestor.parent
      }
    }
    if (!ancestor || !matchesSimpleSelector(ancestor.element, selector)) return false
    ancestor = ancestor.parent
  }
  return true
}

function matchesChildSelector(
  element: DesignElement,
  parts: string[],
  parent: AncestorContext | null
): boolean {
  return matchesSelectorParts(element, parts, parent, true)
}

function matchesDescendantSelector(
  element: DesignElement,
  parts: string[],
  parent: AncestorContext | null
): boolean {
  return matchesSelectorParts(element, parts, parent, false)
}

function applyComputedStyles(
  node: DesignNode,
  rules: HeadlessCSSRule[],
  parent: AncestorContext | null,
  inheritedStyle: DesignStyleDeclaration
): DesignNode {
  if (node.type === 'text') return node

  const computedStyle: DesignStyleDeclaration = pickInheritedStyle(inheritedStyle)
  const matchingRules = rules
    .filter((rule) => matchesSelector(node, rule.selector, parent))
    .sort((left, right) => left.specificity - right.specificity || left.order - right.order)

  for (const rule of matchingRules) Object.assign(computedStyle, rule.style)
  Object.assign(computedStyle, expandStyleShorthands(node.inlineStyle ?? {}))

  const context = { element: node, parent }
  return {
    ...node,
    computedStyle: Object.keys(computedStyle).length > 0 ? computedStyle : undefined,
    children: node.children.map((child) =>
      applyComputedStyles(child, rules, context, computedStyle)
    )
  }
}

function pickInheritedStyle(style: DesignStyleDeclaration): DesignStyleDeclaration {
  const inherited: DesignStyleDeclaration = {}
  for (const property of INHERITED_PROPERTIES) {
    const value = style[property]
    if (value) inherited[property] = value
  }
  return inherited
}

export function computeHeadlessStyles(document: DesignDocument, cssText = ''): DesignDocument {
  const stylesheetText = [document.stylesheets?.map((sheet) => sheet.cssText).join('\n'), cssText]
    .filter((text): text is string => !!text)
    .join('\n')
  const { rules } = parseRules(stylesheetText)

  return {
    ...document,
    children: document.children.map((child) => applyComputedStyles(child, rules, null, {}))
  }
}

function customPropertiesOf(rules: readonly ParsedCSSRule[]): DesignStyleDeclaration {
  return Object.fromEntries(
    rules.flatMap((rule) => Object.entries(rule.style).filter(([key]) => key.startsWith('--')))
  )
}
