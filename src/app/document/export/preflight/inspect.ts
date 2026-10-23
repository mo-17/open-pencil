import type { ShaderFrameStatus } from '@open-pencil/core/editor'
import {
  contentShader,
  readShaderPaints,
  shaderContentNode,
  shaderOfPaint,
  type Fill,
  type Stroke,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

export type ExportIssueCode =
  | 'missing-image'
  | 'shader-missing'
  | 'shader-pending'
  | 'shader-static'
  | 'shader-stale'
  | 'shader-unsupported'
  | 'scan-limit'
export interface ExportIssue {
  code: string
  severity: 'error' | 'warning' | 'info'
  nodeId?: string
  message: string
}
export interface ExportPreflightReport {
  format: string
  nodeCount: number
  issues: ExportIssue[]
  truncated: boolean
  blockingCount: number
  sceneVersion?: number
  nodeIds: string[]
}
export interface ExportPreflightOptions {
  format: string
  canRenderShaders?: boolean
  sceneVersion?: number
  shaderStatus?: (id: string, image: string) => ShaderFrameStatus | null
}
const MAX_SCAN_NODES = 10_000
const MAX_ISSUES = 100
type ReportIssue = (code: ExportIssueCode, nodeId?: string) => void

function issueSeverity(code: ExportIssueCode, documentFormat: boolean): ExportIssue['severity'] {
  if (code === 'missing-image' || code === 'shader-missing')
    return documentFormat ? 'warning' : 'error'
  return code === 'shader-static' ? 'info' : 'warning'
}

function inspectPaint(
  graph: SceneGraph,
  node: SceneNode,
  paint: Fill | Stroke,
  documentFormat: boolean,
  options: ExportPreflightOptions,
  issue: ReportIssue
): void {
  if (!paint.visible || paint.opacity === 0) return
  const shader = shaderOfPaint(node, paint)
  if (!shader) {
    if (paint.imageHash && !graph.images.get(paint.imageHash)?.byteLength)
      issue('missing-image', node.id)
    return
  }
  const status = options.shaderStatus?.(node.id, shader.image)
  if (status?.phase === 'unsupported') {
    issue('shader-unsupported', node.id)
    return
  }
  if (!graph.images.get(shader.image)?.byteLength) {
    issue(options.canRenderShaders ? 'shader-pending' : 'shader-missing', node.id)
    return
  }
  if (shader.input && !documentFormat) issue('shader-static', node.id)
  if (status && status.phase !== 'ready') issue('shader-stale', node.id)
}

function inspectNode(
  graph: SceneGraph,
  node: SceneNode,
  documentFormat: boolean,
  options: ExportPreflightOptions,
  issue: ReportIssue
): SceneNode {
  const hasContent = readShaderPaints(node).some((shader) => shader.input)
  const content = !documentFormat && hasContent ? contentShader(graph, node) : null
  const projected = !documentFormat && hasContent ? shaderContentNode(graph, node) : node
  if (!documentFormat && hasContent && !content) issue('shader-unsupported', node.id)
  if (content && !graph.images.get(content.shader.image)?.byteLength)
    issue(options.canRenderShaders ? 'shader-pending' : 'shader-missing', node.id)
  for (const paint of [...projected.fills, ...projected.strokes])
    inspectPaint(graph, node, paint, documentFormat, options, issue)
  return projected
}

export function inspectExportReadiness(
  graph: SceneGraph,
  nodeIds: readonly string[],
  options: ExportPreflightOptions
): ExportPreflightReport {
  const report: ExportPreflightReport = {
    format: options.format,
    nodeCount: 0,
    issues: [],
    truncated: false,
    blockingCount: 0,
    sceneVersion: options.sceneVersion,
    nodeIds: nodeIds.slice(0, MAX_SCAN_NODES)
  }
  const seen = new Set<string>()
  const pending: Iterator<string>[] = [nodeIds[Symbol.iterator]()]
  let visited = 0
  const format = options.format.toLowerCase()
  const documentFormat = format === 'fig' || format === 'pen'
  function issue(code: ExportIssueCode, nodeId?: string) {
    const severity = issueSeverity(code, documentFormat)
    if (severity === 'error') report.blockingCount++
    if (report.issues.length < MAX_ISSUES)
      report.issues.push({ code, severity, nodeId, message: code })
    else report.truncated = true
  }
  while (pending.length > 0) {
    const next = pending.at(-1)?.next()
    if (!next || next.done) {
      pending.pop()
      continue
    }
    if (visited++ === MAX_SCAN_NODES) {
      report.truncated = true
      issue('scan-limit')
      break
    }
    const id = next.value
    if (seen.has(id)) continue
    seen.add(id)
    const node = graph.getNode(id)
    if (!node || !node.visible) continue
    report.nodeCount++
    const projected = inspectNode(graph, node, documentFormat, options, issue)
    pending.push(projected.childIds[Symbol.iterator]())
  }
  return report
}

export function requireExportReadiness(report: ExportPreflightReport): void {
  const errors = report.issues.filter((issue) => issue.severity === 'error')
  if (report.blockingCount > 0)
    throw new Error(
      `Export preflight failed (${report.blockingCount}): ${errors
        .map((issue) => `${issue.code}${issue.nodeId ? ` (${issue.nodeId})` : ''}`)
        .join(', ')}`
    )
}

export function exportIssueMessage(issue: ExportIssue): string {
  const descriptions: Record<ExportIssueCode, string> = {
    'missing-image': 'A referenced image is missing. Restore the source image before exporting.',
    'shader-missing':
      'No saved Shader frame is available. Render a frame on a supported host first.',
    'shader-pending': 'The export must finish rendering the required Shader frame.',
    'shader-static': 'This target uses the saved still image for this own-content Shader.',
    'shader-stale': 'A saved Shader fallback is available; the latest edit has not been rendered.',
    'shader-unsupported': 'This content filter is unsupported; the authored content is preserved.',
    'scan-limit': 'The bounded scan stopped early. This is not a complete document validation.'
  }
  return Object.hasOwn(descriptions, issue.code)
    ? descriptions[issue.code as ExportIssueCode]
    : issue.message
}
