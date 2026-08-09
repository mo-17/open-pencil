import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import { DESIGN_SYSTEM_AUDIT_COMMAND, type DESIGN_SYSTEM_AUDIT_PLUGIN_ID } from '../ids'

export const DESIGN_SYSTEM_AUDIT_COMMAND_ID = DESIGN_SYSTEM_AUDIT_COMMAND.commandId
export const DESIGN_SYSTEM_AUDIT_LIMITS = Object.freeze({
  nodes: 25_000,
  variables: 10_000,
  collections: 1_000,
  issues: 1_000,
  reportBytes: 512 * 1024,
  collectionModes: 4_096,
  collectionVariableReferences: 20_000,
  variableModeValues: 32_768,
  boundVariables: 16_384,
  componentProperties: 16_384,
  componentChildren: 16_384,
  distinctSpacingValues: 512,
  distinctFontFamilies: 256,
  distinctFontSizes: 256,
  textStyles: 1_000,
  checkpointWork: 512
})

export type DesignSystemAuditCategory = 'tokens' | 'components' | 'spacing' | 'typography'
export type DesignSystemAuditSeverity = 'warning' | 'info'

export interface DesignSystemAuditIssue extends JsonObject {
  category: DesignSystemAuditCategory
  code: string
  severity: DesignSystemAuditSeverity
  message: string
  nodeId?: string
  nodeName?: string
}

export interface DesignSystemAuditSummary extends JsonObject {
  visitedNodeCount: number
  variableCount: number
  collectionCount: number
  componentSetCount: number
  spacingValueCount: number
  fontFamilyCount: number
  fontSizeCount: number
  textStyleCount: number
}

export interface StaticDesignSystemAuditResult extends JsonObject {
  kind: 'static-design-system-audit'
  scope: 'document'
  pluginId: typeof DESIGN_SYSTEM_AUDIT_PLUGIN_ID
  commandId: typeof DESIGN_SYSTEM_AUDIT_COMMAND_ID
  warningCount: number
  infoCount: number
  issueCount: number
  truncated: boolean
  summary: DesignSystemAuditSummary
  issues: DesignSystemAuditIssue[]
  notEvaluated: string[]
}

export interface RunDesignSystemAuditOptions {
  signal?: AbortSignal
}

export interface DesignSystemAuditState {
  issues: DesignSystemAuditIssue[]
  issueBytes: number
  issueCount: number
  warningCount: number
  infoCount: number
  truncated: boolean
  captureIssues: boolean
  work: number
  visitedNodeCount: number
  variableCount: number
  collectionCount: number
  componentSetCount: number
  totalCollectionModes: number
  totalCollectionVariableReferences: number
  totalVariableModeValues: number
  totalBoundVariables: number
  totalComponentProperties: number
  totalComponentChildren: number
}

const encoder = new TextEncoder()
const REPORT_RESERVED_BYTES = 16 * 1024

export function designSystemAuditJsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

export function boundedAuditText(value: string, maximum: number): string {
  const prefix = value.length > maximum * 2 ? value.slice(0, maximum * 2) : value
  let output = ''
  let length = 0
  for (const codePoint of prefix.normalize('NFC')) {
    if (length >= maximum) break
    output += codePoint
    length += 1
  }
  return output
}

export function normalizedAuditKey(value: string, maximum = 256): string {
  return boundedAuditText(value, maximum).trim().toLocaleLowerCase('en-US')
}

function abortError(): Error {
  const error = new Error('Design system audit was cancelled')
  error.name = 'AbortError'
  return error
}

export function throwIfDesignSystemAuditAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError()
}

export async function designSystemAuditCheckpoint(
  state: DesignSystemAuditState,
  signal: AbortSignal | undefined,
  force = false
): Promise<void> {
  throwIfDesignSystemAuditAborted(signal)
  state.work += 1
  if (!force && state.work % DESIGN_SYSTEM_AUDIT_LIMITS.checkpointWork !== 0) return
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  throwIfDesignSystemAuditAborted(signal)
}

export function addDesignSystemAuditIssue(
  state: DesignSystemAuditState,
  issue: DesignSystemAuditIssue
): void {
  state.issueCount += 1
  if (issue.severity === 'warning') state.warningCount += 1
  else state.infoCount += 1
  if (!state.captureIssues) return
  if (state.issues.length >= DESIGN_SYSTEM_AUDIT_LIMITS.issues) {
    state.truncated = true
    state.captureIssues = false
    return
  }
  const bounded: DesignSystemAuditIssue = {
    category: issue.category,
    code: boundedAuditText(issue.code, 96),
    severity: issue.severity,
    message: boundedAuditText(issue.message, 800),
    ...(issue.nodeId ? { nodeId: boundedAuditText(issue.nodeId, 256) } : {}),
    ...(issue.nodeName ? { nodeName: boundedAuditText(issue.nodeName, 256) } : {})
  }
  const issueBytes = designSystemAuditJsonBytes(bounded) + 1
  if (
    state.issueBytes + issueBytes >
    DESIGN_SYSTEM_AUDIT_LIMITS.reportBytes - REPORT_RESERVED_BYTES
  ) {
    state.truncated = true
    state.captureIssues = false
    return
  }
  state.issues.push(bounded)
  state.issueBytes += issueBytes
}

export function markDesignSystemAuditBudgetExhausted(state: DesignSystemAuditState): void {
  state.truncated = true
}

export function createDesignSystemAuditState(): DesignSystemAuditState {
  return {
    issues: [],
    issueBytes: 0,
    issueCount: 0,
    warningCount: 0,
    infoCount: 0,
    truncated: false,
    captureIssues: true,
    work: 0,
    visitedNodeCount: 0,
    variableCount: 0,
    collectionCount: 0,
    componentSetCount: 0,
    totalCollectionModes: 0,
    totalCollectionVariableReferences: 0,
    totalVariableModeValues: 0,
    totalBoundVariables: 0,
    totalComponentProperties: 0,
    totalComponentChildren: 0
  }
}
