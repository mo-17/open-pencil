export interface CSSStyleDeclarationLike {
  readonly length: number
  readonly [index: number]: string
  getPropertyValue(property: string): string
}

export interface CSSStyleRuleLike {
  selectorText: string
  style: CSSStyleDeclarationLike
}

export class CSSStyleDeclaration implements CSSStyleDeclarationLike {
  readonly length: number;
  readonly [index: number]: string
  readonly cssText: string
  getPropertyValue(property: string): string
  setProperty(property: string, value: string, priority?: string): void
}

export class CSSFontFaceRule {
  readonly cssText: string
  style: CSSStyleDeclaration
}

export class CSSStyleSheet {
  readonly cssRules: ArrayLike<
    | {
        style: CSSStyleDeclaration
      }
    | undefined
  >
  /** Parses `rule`, throwing on an invalid selector, and returns its index. */
  insertRule(rule: string, index?: number): number
  toString(): string
}

export interface CSSGroupingRuleLike {
  cssRules: unknown[]
}

export interface CSSStyleSheetLike {
  cssRules: unknown[]
}

export function parse(cssText: string): CSSStyleSheetLike
export interface CSSOMRuntime {
  CSSStyleDeclaration: typeof CSSStyleDeclaration
  CSSFontFaceRule: typeof CSSFontFaceRule
  CSSStyleSheet: typeof CSSStyleSheet
  parse: typeof parse
}
