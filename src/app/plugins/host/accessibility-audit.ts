import { createLinter, type LintMessage } from '@open-pencil/core/lint'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'

const MAX_ISSUES = 2_000
const MAX_REPORT_BYTES = 512 * 1024
const MAX_AUDIT_NODES = 25_000
const MAX_AUDIT_DEPTH = 256
const MAX_CHILDREN_PER_NODE = 2_000
const MAX_STYLE_ENTRIES_PER_NODE = 256
const MAX_TEXT_CODE_POINTS = 4_096
const MAX_BOUND_VARIABLES_PER_NODE = 512
const MAX_STRUCTURED_PAYLOAD_NODES = 16_384
const MAX_STRUCTURED_MEMBERS_PER_CONTAINER = 512
const MAX_TOTAL_STYLE_ENTRIES = 16_384
const MAX_TOTAL_TEXT_CODE_POINTS = 262_144
const MAX_TOTAL_BOUND_VARIABLES = 16_384
const MAX_TOTAL_STRUCTURED_PAYLOAD_NODES = 131_072
const encoder = new TextEncoder()

export interface StaticAccessibilityAuditResult extends JsonObject {
  kind: 'static-accessibility-audit'
  scope: 'document'
  errorCount: number
  warningCount: number
  infoCount: number
  issueCount: number
  truncated: boolean
  issues: JsonObject[]
  notEvaluated: string[]
}

function boundedText(value: string, maximum: number): string {
  const prefix = value.length > maximum * 2 ? value.slice(0, maximum * 2) : value
  let result = ''
  let count = 0
  for (const codePoint of prefix.normalize('NFC')) {
    if (count >= maximum) break
    result += codePoint
    count += 1
  }
  return result
}

function serializeIssue(issue: LintMessage): JsonObject {
  return {
    ruleId: issue.ruleId,
    severity: issue.severity,
    message: boundedText(issue.message, 1_000),
    nodeId: boundedText(issue.nodeId, 256),
    nodeName: boundedText(issue.nodeName, 256),
    nodePath: issue.nodePath.slice(0, 32).map((segment) => boundedText(segment, 256)),
    ...(issue.suggest ? { suggestion: boundedText(issue.suggest, 1_000) } : {})
  }
}

export function runStaticAccessibilityAudit(editor: EditorStore): StaticAccessibilityAuditResult {
  const result = createLinter({
    preset: 'accessibility',
    limits: {
      maxNodes: MAX_AUDIT_NODES,
      maxMessages: MAX_ISSUES,
      maxDepth: MAX_AUDIT_DEPTH,
      maxChildrenPerNode: MAX_CHILDREN_PER_NODE,
      maxStyleEntriesPerNode: MAX_STYLE_ENTRIES_PER_NODE,
      maxTotalStyleEntries: MAX_TOTAL_STYLE_ENTRIES,
      maxTextCodePoints: MAX_TEXT_CODE_POINTS,
      maxTotalTextCodePoints: MAX_TOTAL_TEXT_CODE_POINTS,
      maxBoundVariablesPerNode: MAX_BOUND_VARIABLES_PER_NODE,
      maxTotalBoundVariables: MAX_TOTAL_BOUND_VARIABLES,
      maxStructuredPayloadNodes: MAX_STRUCTURED_PAYLOAD_NODES,
      maxTotalStructuredPayloadNodes: MAX_TOTAL_STRUCTURED_PAYLOAD_NODES,
      maxStructuredMembersPerContainer: MAX_STRUCTURED_MEMBERS_PER_CONTAINER
    }
  }).lintGraph(editor.graph)
  const issues: JsonObject[] = []
  let reportBytes = 512
  for (const message of result.messages.slice(0, MAX_ISSUES)) {
    const issue = serializeIssue(message)
    const issueBytes = encoder.encode(JSON.stringify(issue)).byteLength
    if (reportBytes + issueBytes > MAX_REPORT_BYTES) break
    issues.push(issue)
    reportBytes += issueBytes
  }
  return {
    kind: 'static-accessibility-audit',
    scope: 'document',
    errorCount: result.errorCount,
    warningCount: result.warningCount,
    infoCount: result.infoCount,
    issueCount: result.messages.length,
    truncated: result.truncated || issues.length < result.messages.length,
    issues,
    notEvaluated: [
      'screen-reader accessible names and image alternatives',
      'keyboard focus order and runtime focus management',
      'form validation announcements and dynamic application state',
      'contrast that depends on variables, images, gradients, or complex compositing',
      ...(result.truncated ? ['content beyond the static audit resource limits'] : [])
    ]
  }
}
