import type { InteractivePropsIssue } from './interactive-props'

/** Reviewed local suggestions only; never evaluates content or fetches a remote source. */
export function parseInputSuggestions(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.trim().length === 0 ||
        entry.length > 200 ||
        /[\r\n]/.test(entry)
    )
  )
    return undefined
  const items: string[] = value
  return new Set(items).size === items.length ? [...items] : undefined
}

export function lowcodeInputRequiresString(ip: Record<string, unknown> | undefined): boolean {
  return (
    ip?.inputType === 'color' ||
    ip?.inputType === 'time' ||
    ip?.inputType === 'datetime-local' ||
    ((ip?.inputType === undefined || ip.inputType === 'text' || ip.inputType === 'search') &&
      Array.isArray(ip?.suggestions) &&
      ip.suggestions.length > 0)
  )
}

export function validateInputSuggestions(ip: Record<string, unknown>): InteractivePropsIssue[] {
  if (ip.suggestions === undefined) return []
  const items = parseInputSuggestions(ip.suggestions)
  if (!items)
    return [
      {
        code: 'input-suggestions-invalid',
        path: 'interactiveProps.suggestions',
        severity: 'error',
        reason:
          'Suggestions must contain at most 100 unique, non-empty strings, each at most 200 characters.'
      }
    ]
  if (
    items.length &&
    ip.inputType !== undefined &&
    ip.inputType !== 'text' &&
    ip.inputType !== 'search'
  )
    return [
      {
        code: 'input-suggestions-type-unsupported',
        path: 'interactiveProps.suggestions',
        severity: 'error',
        reason: 'Suggestions are supported only on text or search inputs.'
      }
    ]
  return []
}
