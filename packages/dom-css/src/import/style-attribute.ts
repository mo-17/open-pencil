import { parseCSSRules } from '../runtime/css-rules'
import type { DesignStyleDeclaration } from '../types'

/** Read authored CSS without an optional CSSOM adapter dropping newer declarations. */
export function parseStyleAttribute(value: string | undefined): DesignStyleDeclaration | undefined {
  if (!value) return undefined
  const style = parseCSSRules(`*{${value}}`).at(0)?.style
  return style && Object.keys(style).length > 0 ? style : undefined
}
