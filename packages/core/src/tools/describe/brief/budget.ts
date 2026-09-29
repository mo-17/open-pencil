import type { DesignBriefWarningCode } from './types'

/** All text budgets are UTF-16 code units, including the final Markdown limit. */
export const DESIGN_BRIEF_LIMITS = Object.freeze({
  nodes: 300,
  roots: 300,
  depth: 64,
  ancestry: 512,
  edges: 10000,
  details: 1200,
  text: 24000,
  textPerField: 512,
  markdown: 100000
})

export class BriefBudget {
  readonly warnings = new Set<DesignBriefWarningCode>(['runtime-not-verified'])
  #text = 0
  #details = 0

  detail(): boolean {
    if (this.#details++ < DESIGN_BRIEF_LIMITS.details) return true
    this.warnings.add('details-truncated')
    return false
  }

  text(value: string, limit = DESIGN_BRIEF_LIMITS.textPerField): string {
    const available = Math.max(0, Math.min(limit, DESIGN_BRIEF_LIMITS.text - this.#text))
    let result = value.slice(0, available)
    if (result.length < value.length) this.warnings.add('text-truncated')
    // Avoid returning half a surrogate pair at the boundary.
    if (/[\uD800-\uDBFF]$/.test(result)) result = result.slice(0, -1)
    if (
      /data:|(?:bearer\s+)|(?:password|secret|token|api[_-]?key)\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:https?|postgres(?:ql)?):\/\/[^\s/:]+:[^\s@]+@/i.test(
        result
      )
    ) {
      this.warnings.add('sensitive-text-omitted')
      return '[omitted]'
    }
    result = Array.from(result)
      .filter((character) => {
        const code = character.charCodeAt(0)
        return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
      })
      .join('')
    this.#text += result.length
    return result
  }
}
