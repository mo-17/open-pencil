import type { JsonValue } from '@open-pencil/scene-graph/primitives'

const MAX_VISIBLE_ISSUES = 100
const MAX_REPORT_ISSUES = 2_000
const MAX_NOT_EVALUATED_ITEMS = 16

interface AccessibilityReportRecord {
  [key: string]: unknown
}

export interface StaticAccessibilityIssueView {
  ruleId: string
  severity: 'error' | 'warning' | 'info'
  message: string
  nodeId: string
  nodeName: string
  nodePath: readonly string[]
  suggestion?: string
}

export interface StaticAccessibilityReportView {
  errorCount: number
  warningCount: number
  infoCount: number
  issueCount: number
  truncated: boolean
  issues: readonly StaticAccessibilityIssueView[]
  notEvaluated: readonly string[]
}

function record(value: unknown): AccessibilityReportRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? (value as AccessibilityReportRecord)
    : null
}

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null
}

function issue(value: unknown): StaticAccessibilityIssueView | null {
  const source = record(value)
  if (!source) return null
  if (
    typeof source.ruleId !== 'string' ||
    !['error', 'warning', 'info'].includes(String(source.severity)) ||
    typeof source.message !== 'string' ||
    typeof source.nodeId !== 'string' ||
    typeof source.nodeName !== 'string' ||
    !Array.isArray(source.nodePath) ||
    source.nodePath.some((segment) => typeof segment !== 'string') ||
    (source.suggestion !== undefined && typeof source.suggestion !== 'string')
  ) {
    return null
  }
  return {
    ruleId: source.ruleId,
    severity: source.severity as StaticAccessibilityIssueView['severity'],
    message: source.message,
    nodeId: source.nodeId,
    nodeName: source.nodeName,
    nodePath: source.nodePath as string[],
    ...(typeof source.suggestion === 'string' ? { suggestion: source.suggestion } : {})
  }
}

/**
 * Treat command result data as untrusted even though bundled adapters currently
 * produce it. Future signed adapters must not be able to inject markup or grow
 * an unbounded settings panel.
 */
export function parseStaticAccessibilityReport(
  value: JsonValue | undefined
): StaticAccessibilityReportView | null {
  const source = record(value)
  if (!source) return null
  if (
    source.kind !== 'static-accessibility-audit' ||
    source.scope !== 'document' ||
    typeof source.truncated !== 'boolean' ||
    !Array.isArray(source.issues) ||
    source.issues.length > MAX_REPORT_ISSUES ||
    !Array.isArray(source.notEvaluated) ||
    source.notEvaluated.length > MAX_NOT_EVALUATED_ITEMS ||
    source.notEvaluated.some((entry) => typeof entry !== 'string')
  ) {
    return null
  }
  const errorCount = count(source.errorCount)
  const warningCount = count(source.warningCount)
  const infoCount = count(source.infoCount)
  const issueCount = count(source.issueCount)
  if (errorCount === null || warningCount === null || infoCount === null || issueCount === null) {
    return null
  }
  const issues = source.issues.slice(0, MAX_VISIBLE_ISSUES).map(issue)
  if (issues.some((entry) => entry === null)) return null
  return {
    errorCount,
    warningCount,
    infoCount,
    issueCount,
    truncated: source.truncated || source.issues.length > MAX_VISIBLE_ISSUES,
    issues: issues as StaticAccessibilityIssueView[],
    notEvaluated: (source.notEvaluated as string[]).slice(0, MAX_NOT_EVALUATED_ITEMS)
  }
}
