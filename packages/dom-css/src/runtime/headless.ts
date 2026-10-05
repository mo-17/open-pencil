import { serializeHTML } from '../export/html'
import { parseStyleAttribute } from '../import/style-attribute'
import { assertInertCSSText, parseInertHTML, sanitizeDesignDocument } from '../inert-markup'
import type { CSSRuntime, DesignDocument } from '../types'
import { computeHeadlessStyles } from './headless-css'

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
