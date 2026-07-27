import type { NodeType } from '@open-pencil/scene-graph'

import { validateDatePickerProps } from './datepicker-props'
import { validateExpression } from './validate'

export type InteractivePropsIssueSeverity = 'error' | 'warning'

export interface InteractivePropsIssue {
  code: string
  path: string
  severity: InteractivePropsIssueSeverity
  reason: string
}

const KNOWN_VALIDATION_KEYS = new Set([
  'required',
  'pattern',
  'minLength',
  'maxLength',
  'min',
  'max',
  'customExpr',
  'messages',
  'async'
])

const KNOWN_VALIDATION_MESSAGE_KEYS = new Set([
  'required',
  'pattern',
  'minLength',
  'maxLength',
  'min',
  'max',
  'custom'
])

const KNOWN_VALIDATION_ASYNC_KEYS = new Set(['url', 'urlExpr', 'method', 'message'])
const KNOWN_VALIDATION_SUMMARY_KEYS = new Set(['enabled', 'title'])

type KnownInteractivePropKind = 'string' | 'boolean' | 'string-array'

const KNOWN_INTERACTIVE_PROP_TYPES: Partial<
  Record<NodeType, Readonly<Record<string, KnownInteractivePropKind>>>
> = {
  BUTTON: { text: 'string' },
  INPUT: { placeholder: 'string', value: 'string' },
  TEXTAREA: { placeholder: 'string', value: 'string' },
  SELECT: { options: 'string-array', value: 'string' },
  RADIO: { options: 'string-array', value: 'string', groupName: 'string' },
  CHECKBOX: { options: 'string-array', checked: 'boolean' },
  SWITCH: { checked: 'boolean' },
  DATEPICKER: { value: 'string', min: 'string', max: 'string' }
}

function error(code: string, path: string, reason: string): InteractivePropsIssue {
  return { code, path, severity: 'error', reason }
}

function matchesKnownPropKind(value: unknown, kind: KnownInteractivePropKind): boolean {
  if (kind === 'string') return typeof value === 'string'
  if (kind === 'boolean') return typeof value === 'boolean'
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function knownPropTypeIssues(
  nodeType: NodeType,
  value: Record<string, unknown>
): InteractivePropsIssue[] {
  const schema = KNOWN_INTERACTIVE_PROP_TYPES[nodeType]
  if (!schema) return []

  const issues: InteractivePropsIssue[] = []
  for (const [key, kind] of Object.entries(schema)) {
    if (!(key in value) || matchesKnownPropKind(value[key], kind)) continue
    const path = `interactiveProps.${key}`
    const expected = kind === 'string-array' ? 'an array of strings' : `a ${kind}`
    issues.push(error(`interactive-props-${key}-type`, path, `${path} must be ${expected}`))
  }
  return issues
}

export function isInteractivePropsObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function jsonIssue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>
): InteractivePropsIssue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return undefined
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? undefined
      : error('interactive-props-non-finite-number', path, `${path} must be a finite number`)
  }
  if (typeof value !== 'object') {
    return error(
      'interactive-props-non-json-value',
      path,
      `${path} must contain only JSON-compatible values`
    )
  }
  if (ancestors.has(value)) {
    return error('interactive-props-cycle', path, `${path} must not contain circular references`)
  }
  if (!Array.isArray(value) && !isInteractivePropsObject(value)) {
    return error(
      'interactive-props-non-plain-object',
      path,
      `${path} must contain only plain JSON objects and arrays`
    )
  }

  ancestors.add(value)
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value)
  for (const [key, child] of entries) {
    const issue = jsonIssue(
      child,
      Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`,
      ancestors
    )
    if (issue) return issue
  }
  ancestors.delete(value)
  return undefined
}

function validationPatternIssue(raw: unknown): InteractivePropsIssue | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') {
    return error(
      'interactive-validation-pattern-type',
      'interactiveProps.validation.pattern',
      'interactiveProps.validation.pattern must be a string'
    )
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(raw)
    return undefined
  } catch {
    return error(
      'interactive-validation-pattern-invalid',
      'interactiveProps.validation.pattern',
      'interactiveProps.validation.pattern must compile as a regular expression'
    )
  }
}

function validationNumberIssue(raw: Record<string, unknown>): InteractivePropsIssue | undefined {
  for (const key of ['minLength', 'maxLength', 'min', 'max'] as const) {
    if (raw[key] === undefined || raw[key] === null) continue
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])) {
      const path = `interactiveProps.validation.${key}`
      return error('interactive-validation-number-type', path, `${path} must be a finite number`)
    }
  }
  return undefined
}

function validationCustomExpressionIssue(raw: unknown): InteractivePropsIssue | undefined {
  if (raw === undefined || raw === null) return undefined
  const path = 'interactiveProps.validation.customExpr'
  if (typeof raw !== 'string') {
    return error('interactive-validation-expression-type', path, `${path} must be a string`)
  }
  const result = validateExpression(raw)
  return result.ok
    ? undefined
    : error('interactive-validation-expression-invalid', path, `${path} — ${result.reason}`)
}

function validationMessagesIssue(raw: unknown): InteractivePropsIssue | undefined {
  if (raw === undefined || raw === null) return undefined
  const path = 'interactiveProps.validation.messages'
  if (!isInteractivePropsObject(raw)) {
    return error('interactive-validation-messages-type', path, `${path} must be an object`)
  }
  for (const [key, value] of Object.entries(raw)) {
    const entryPath = `${path}.${key}`
    if (!KNOWN_VALIDATION_MESSAGE_KEYS.has(key)) {
      return error(
        'interactive-validation-message-key',
        entryPath,
        `${entryPath} is not supported — allowed: ${[...KNOWN_VALIDATION_MESSAGE_KEYS].join(' / ')}`
      )
    }
    if (typeof value !== 'string') {
      return error(
        'interactive-validation-message-type',
        entryPath,
        `${entryPath} must be a string`
      )
    }
  }
  return undefined
}

function asyncValidationUrlIssue(raw: Record<string, unknown>): InteractivePropsIssue | undefined {
  const path = 'interactiveProps.validation.async'
  const hasUrl = typeof raw.url === 'string' && raw.url.trim() !== ''
  const hasUrlExpr = typeof raw.urlExpr === 'string' && raw.urlExpr.trim() !== ''
  if (raw.url !== undefined && raw.url !== null && typeof raw.url !== 'string') {
    return error(
      'interactive-validation-async-url-type',
      `${path}.url`,
      `${path}.url must be a string`
    )
  }
  if (raw.urlExpr !== undefined && raw.urlExpr !== null && typeof raw.urlExpr !== 'string') {
    return error(
      'interactive-validation-async-url-expr-type',
      `${path}.urlExpr`,
      `${path}.urlExpr must be a string`
    )
  }
  if (hasUrl && hasUrlExpr) {
    return error(
      'interactive-validation-async-url-conflict',
      path,
      `${path} must use either url or urlExpr, not both`
    )
  }
  if (!hasUrl && !hasUrlExpr) {
    return error(
      'interactive-validation-async-url-required',
      path,
      `${path} requires a non-empty url or urlExpr`
    )
  }
  if (!hasUrlExpr) return undefined
  const result = validateExpression(String(raw.urlExpr))
  return result.ok
    ? undefined
    : error(
        'interactive-validation-async-url-expr-invalid',
        `${path}.urlExpr`,
        `${path}.urlExpr — ${result.reason}`
      )
}

function asyncValidationIssue(raw: unknown): InteractivePropsIssue | undefined {
  if (raw === undefined || raw === null) return undefined
  const path = 'interactiveProps.validation.async'
  if (!isInteractivePropsObject(raw)) {
    return error('interactive-validation-async-type', path, `${path} must be an object`)
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_VALIDATION_ASYNC_KEYS.has(key)) {
      const entryPath = `${path}.${key}`
      return error(
        'interactive-validation-async-key',
        entryPath,
        `${entryPath} is not supported — allowed: ${[...KNOWN_VALIDATION_ASYNC_KEYS].join(' / ')}`
      )
    }
  }
  const urlIssue = asyncValidationUrlIssue(raw)
  if (urlIssue) return urlIssue
  if (raw.method !== undefined && raw.method !== null) {
    if (
      typeof raw.method !== 'string' ||
      !['GET', 'POST'].includes(raw.method.trim().toUpperCase())
    ) {
      return error(
        'interactive-validation-async-method',
        `${path}.method`,
        `${path}.method must be GET or POST`
      )
    }
  }
  if (raw.message !== undefined && raw.message !== null && typeof raw.message !== 'string') {
    return error(
      'interactive-validation-async-message-type',
      `${path}.message`,
      `${path}.message must be a string`
    )
  }
  return undefined
}

function fieldValidationIssue(raw: unknown): InteractivePropsIssue | undefined {
  if (raw === null) return undefined
  const path = 'interactiveProps.validation'
  if (!isInteractivePropsObject(raw)) {
    return error('interactive-validation-type', path, `${path} must be an object or null`)
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_VALIDATION_KEYS.has(key)) {
      const entryPath = `${path}.${key}`
      return error(
        'interactive-validation-key',
        entryPath,
        `${entryPath} is not supported — allowed: ${[...KNOWN_VALIDATION_KEYS].join(' / ')}`
      )
    }
  }
  if ('required' in raw && typeof raw.required !== 'boolean') {
    return error(
      'interactive-validation-required-type',
      `${path}.required`,
      `${path}.required must be a boolean`
    )
  }
  return (
    validationPatternIssue(raw.pattern) ??
    validationNumberIssue(raw) ??
    validationCustomExpressionIssue(raw.customExpr) ??
    validationMessagesIssue(raw.messages) ??
    asyncValidationIssue(raw.async)
  )
}

function validationSummaryIssue(raw: unknown): InteractivePropsIssue | undefined {
  if (raw === null || typeof raw === 'boolean') return undefined
  const path = 'interactiveProps.validationSummary'
  if (!isInteractivePropsObject(raw)) {
    return error(
      'interactive-validation-summary-type',
      path,
      `${path} must be a boolean, object, or null`
    )
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_VALIDATION_SUMMARY_KEYS.has(key)) {
      const entryPath = `${path}.${key}`
      return error(
        'interactive-validation-summary-key',
        entryPath,
        `${entryPath} is not supported — allowed: ${[...KNOWN_VALIDATION_SUMMARY_KEYS].join(' / ')}`
      )
    }
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    return error(
      'interactive-validation-summary-enabled-type',
      `${path}.enabled`,
      `${path}.enabled must be a boolean`
    )
  }
  if (raw.title !== undefined && raw.title !== null && typeof raw.title !== 'string') {
    return error(
      'interactive-validation-summary-title-type',
      `${path}.title`,
      `${path}.title must be a string`
    )
  }
  return undefined
}

function datePickerIssues(ip: Record<string, unknown>): InteractivePropsIssue[] {
  return validateDatePickerProps(ip).map((issue) => {
    const path = issue.key ? `interactiveProps.${issue.key}` : 'interactiveProps'
    if (issue.code.startsWith('datepicker-invalid') && issue.key) {
      return error(issue.code, path, `${path} must be a valid YYYY-MM-DD date`)
    }
    const reason =
      issue.code === 'datepicker-range-inverted'
        ? 'interactiveProps.min must not be after interactiveProps.max'
        : 'interactiveProps.value is outside the configured min/max range'
    return { code: issue.code, path, severity: 'warning', reason }
  })
}

/**
 * Validate the shared lowcode `interactiveProps` boundary without rejecting
 * unknown top-level keys. The compiler intentionally supports extensible
 * namespaces such as `uiKit`, `image`, `link`, and `layout`; this validator
 * checks JSON safety, the known per-control primitive fields, and the schemas
 * it owns (`validation`, `validationSummary`, and DATEPICKER dates).
 */
export function validateInteractiveProps(
  nodeType: NodeType,
  value: unknown
): InteractivePropsIssue[] {
  if (!isInteractivePropsObject(value)) {
    return [
      error('interactive-props-type', 'interactiveProps', 'interactiveProps must be an object')
    ]
  }

  const json = jsonIssue(value, 'interactiveProps', new WeakSet())
  if (json) return [json]

  const issues: InteractivePropsIssue[] = []
  issues.push(...knownPropTypeIssues(nodeType, value))
  if ('validation' in value) {
    const issue = fieldValidationIssue(value.validation)
    if (issue) issues.push(issue)
  }
  if ('validationSummary' in value) {
    const issue = validationSummaryIssue(value.validationSummary)
    if (issue) issues.push(issue)
  }
  if (nodeType === 'DATEPICKER') issues.push(...datePickerIssues(value))
  return issues
}
