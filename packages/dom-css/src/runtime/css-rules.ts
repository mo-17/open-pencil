import { generate, parse, walk } from 'css-tree'

import type { DesignStyleDeclaration } from '../types'

export interface ParsedCSSRule {
  selectorText: string
  style: DesignStyleDeclaration
}

/** Preserve authored declarations, including modern properties optional CSSOM adapters drop. */
export function parseCSSRules(css: string): ParsedCSSRule[] {
  const rules: ParsedCSSRule[] = []
  const tree = parse(css, { parseRulePrelude: false, parseValue: false })
  walk(tree, {
    visit: 'Rule',
    enter(rule) {
      const style: DesignStyleDeclaration = {}
      for (const declaration of rule.block.children) {
        if (declaration.type !== 'Declaration') continue
        style[declaration.property] = generate(declaration.value).trim()
      }
      rules.push({ selectorText: generate(rule.prelude).trim(), style })
    }
  })
  return rules
}
