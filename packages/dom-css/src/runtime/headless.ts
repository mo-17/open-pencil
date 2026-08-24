import { computeHeadlessStyles } from '../headless-css'
import { assertInertCSSText, parseInertHTML, sanitizeDesignDocument } from '../inert-markup'
import { serializeHTML } from '../serialize'
import { parseStyleAttribute } from '../style-attribute'
import type { CSSRuntime, DesignDocument } from '../types'

export function createHeadlessCSSRuntime(): CSSRuntime {
  return {
    kind: 'headless',
    parseHTML: (html) => parseInertHTML(html, parseStyleAttribute),
    serializeHTML(document: DesignDocument) {
      return serializeHTML(document)
    },
    async computeStyles(document: DesignDocument, cssText = '') {
      assertInertCSSText(cssText)
      return computeHeadlessStyles(sanitizeDesignDocument(document), cssText)
    }
  }
}
