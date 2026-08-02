import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { FigmaAPI } from '#core/figma-api'
import { buttonLabelTextNode } from '#core/text/lowcode'
import { defineTool } from '#core/tools/schema'

import {
  inspectNodeFontRendering,
  type FontRenderingCheckResult,
  type NodeFontReadiness
} from './fonts'

type FontRenderingAuditScope = 'ids' | 'page' | 'document'
type FontRenderReady = 'ready' | 'degraded' | 'pending' | 'not_ready' | 'unverifiable'
type FontRetryStatus =
  | 'not_requested'
  | 'not_needed'
  | 'settled'
  | 'settled_degraded'
  | 'exhausted'
  | 'timed_out'
  | 'unverifiable'
  | 'partial'

const MAX_AUDITED_FONT_NODES = 2_000
const MAX_SCANNED_SCENE_NODES = 20_000

interface FontRenderingAuditNode extends FontRenderingCheckResult {
  pageId: string
  renderReady: FontRenderReady
  requestedFaces: Array<{
    family: string
    style: string
    scopes: FontRenderingCheckResult['faces'][number]['scopes']
  }>
  actualFaces: Array<{
    requestedFamily: string
    requestedStyle: string
    mode: FontRenderingCheckResult['faces'][number]['mode']
    loadedFamily: string | null
    loadedStyle: string | null
    source: string | null
  }>
  glyphFallback: {
    family: null
    observation: 'unavailable' | 'pending' | 'resolved_family_unobservable' | 'unresolved'
  }
}

interface FontRetryResult {
  requested: boolean
  status: FontRetryStatus
  complete: boolean
  attempts: number
  timeoutMs: number
  auditedStatus?: Exclude<FontRetryStatus, 'partial'>
  reason?: string
}

interface CollectedFontNodes {
  nodes: SceneNode[]
  matched: number
  scannedSceneNodes: number
  complete: boolean
  auditLimitReached: boolean
  scanLimitReached: boolean
}

export const auditFontRendering = defineTool({
  name: 'audit_font_rendering',
  description:
    'Audit whether authored TEXT and lowcode BUTTON-label fonts are render-ready in the live CanvasKit host. Supports explicit node/subtree ids, one page, or the whole document. Reports requested faces separately from the actually loaded exact/synthesized face, resolver channel, pending/exhausted glyph readiness, and an explicit unverifiable state when no renderer is attached. CanvasKit does not expose the family that shaped each fallback glyph, so fallback family is returned as null rather than guessed. Optional retry is bounded by max_retries and timeout_ms. Font licensing is deliberately NOT inferred from renderability; run audit_font_licenses separately.',
  params: {
    scope: {
      type: 'string',
      description: 'Audit explicit ids/subtrees, one page, or every document page (default page)',
      enum: ['ids', 'page', 'document'],
      default: 'page'
    },
    ids: {
      type: 'string[]',
      description: 'Root node ids (each root and descendants); required for scope=ids',
      minItems: 1,
      maxItems: 200
    },
    page_id: {
      type: 'string',
      description: 'CANVAS page id for scope=page; defaults to current page'
    },
    retry: {
      type: 'boolean',
      description:
        'Retry unresolved faces and observed glyph-coverage demands, then wait for renderer readiness (default false)',
      default: false
    },
    max_retries: {
      type: 'number',
      description: 'Maximum retry attempts when retry=true (default 1, range 1-2)',
      min: 1,
      max: 2,
      default: 1
    },
    timeout_ms: {
      type: 'number',
      description: 'Total bounded wait when retry=true (default 1500ms, range 50-10000)',
      min: 50,
      max: 10000,
      default: 1500
    },
    max_nodes: {
      type: 'number',
      description: 'Maximum text/button-label results returned (default 200, range 1-500)',
      min: 1,
      max: 500,
      default: 200
    }
  },
  execute: async (figma, args, ctx) => {
    const requestedScope = args.scope ?? 'page'
    if (!['ids', 'page', 'document'].includes(requestedScope)) {
      return { error: `Unknown font rendering audit scope "${requestedScope}"` }
    }
    const scope = requestedScope as FontRenderingAuditScope
    const roots = resolveScopeRoots(figma.graph, figma.currentPageId, scope, args.ids, args.page_id)
    if ('error' in roots) return roots

    const maxNodes = boundedInteger(args.max_nodes, 200, 1, 500)
    const collected = collectFontNodes(figma.graph, roots.rootIds)
    let nodes = inspectNodes(figma, collected.nodes)
    const timeoutMs = boundedInteger(args.timeout_ms, 1500, 50, 10000)
    const maxRetries = boundedInteger(args.max_retries, 1, 1, 2)
    let retry: FontRetryResult = {
      requested: args.retry === true,
      status: args.retry === true ? 'not_needed' : 'not_requested',
      complete: true,
      attempts: 0,
      timeoutMs
    }

    if (args.retry === true) {
      const retried = await retryFontNodes(figma, collected.nodes, nodes, {
        timeoutMs,
        maxRetries,
        signal: ctx?.signal
      })
      nodes = retried.nodes
      retry = retried.retry
    }

    const auditNodes = nodes.map((node) => toAuditNode(figma.graph, node))
    const complete = collected.complete && nodes.length === collected.nodes.length
    retry = applyRetryCompleteness(retry, complete, collected)
    const returnedNodes = auditNodes.slice(0, maxNodes)
    return {
      scope: {
        kind: scope,
        complete,
        roots: roots.rootIds.map((id) => {
          const node = figma.graph.getNode(id)
          return { id, name: node?.name ?? '', type: node?.type ?? 'UNKNOWN' }
        })
      },
      summary: summarize(auditNodes, collected, returnedNodes.length, complete),
      retry,
      license: {
        status: 'not_assessed',
        renderabilityIsLicenseEvidence: false,
        suggestedTool: 'audit_font_licenses'
      },
      nodes: returnedNodes,
      limitations: [
        'Render-ready, installed, downloadable, or provider-listed does not mean free or licensed.',
        'CanvasKit confirms glyph readiness but does not expose which fallback family shaped each glyph.',
        'A renderer-unavailable result is unverifiable, never successful.',
        'Retry may load font bytes into runtime caches but does not change authored font assignments.',
        `Audits inspect at most ${MAX_AUDITED_FONT_NODES} font nodes while scanning at most ${MAX_SCANNED_SCENE_NODES} scene nodes; complete=false reports a partial scope.`
      ]
    }
  }
})

function resolveScopeRoots(
  graph: SceneGraph,
  currentPageId: string,
  scope: FontRenderingAuditScope,
  ids: string[] | undefined,
  pageId: string | undefined
): { rootIds: string[] } | { error: string } {
  if (scope !== 'ids' && ids !== undefined) {
    return { error: 'ids can only be used with scope="ids"' }
  }
  if (scope !== 'page' && pageId !== undefined) {
    return { error: 'page_id can only be used with scope="page"' }
  }
  if (scope === 'ids') {
    const rootIds = ids === undefined ? [] : [...new Set(ids)]
    if (rootIds.length === 0) return { error: 'ids is required when scope="ids"' }
    if (rootIds.length > 200) return { error: 'ids supports at most 200 roots' }
    const missing = rootIds.filter((id) => !graph.getNode(id))
    if (missing.length > 0) return { error: `Nodes not found: ${missing.slice(0, 10).join(', ')}` }
    return { rootIds }
  }
  if (scope === 'document') return { rootIds: graph.getPages().map((page) => page.id) }
  const targetPageId = pageId ?? currentPageId
  const page = graph.getNode(targetPageId)
  if (page?.type !== 'CANVAS') return { error: `Page "${targetPageId}" not found` }
  return { rootIds: [targetPageId] }
}

function collectFontNodes(graph: SceneGraph, rootIds: readonly string[]): CollectedFontNodes {
  const nodes: SceneNode[] = []
  const visited = new Set<string>()
  let matched = 0
  let auditLimitReached = false
  let scanLimitReached = false
  const stack = [...rootIds].reverse()
  while (stack.length > 0) {
    if (visited.size >= MAX_SCANNED_SCENE_NODES) {
      scanLimitReached = true
      break
    }
    const id = stack.pop()
    if (id === undefined || visited.has(id)) continue
    visited.add(id)
    const node = graph.getNode(id)
    if (!node) continue
    if (node.type === 'TEXT' || buttonLabelTextNode(node)) {
      matched++
      if (nodes.length < MAX_AUDITED_FONT_NODES) nodes.push(node)
      else auditLimitReached = true
    }
    for (let index = node.childIds.length - 1; index >= 0; index--) {
      stack.push(node.childIds[index])
    }
  }
  return {
    nodes,
    matched,
    scannedSceneNodes: visited.size,
    complete: !auditLimitReached && !scanLimitReached,
    auditLimitReached,
    scanLimitReached
  }
}

function inspectNodes(figma: FigmaAPI, nodes: readonly SceneNode[]): FontRenderingCheckResult[] {
  const results: FontRenderingCheckResult[] = []
  for (const node of nodes) {
    const result = inspectNodeFontRendering(figma, node.id)
    if (!('error' in result)) results.push(result)
  }
  return results
}

function toAuditNode(graph: SceneGraph, check: FontRenderingCheckResult): FontRenderingAuditNode {
  return {
    ...check,
    pageId: owningPageId(graph, check.id),
    renderReady: renderReady(check),
    requestedFaces: check.faces.map((face) => ({
      family: face.family,
      style: face.style,
      scopes: face.scopes
    })),
    actualFaces: check.faces.map((face) => {
      const settledCandidate =
        face.resolution.state === 'loaded' ? face.resolution.candidate : undefined
      return {
        requestedFamily: face.family,
        requestedStyle: face.style,
        mode: face.mode,
        loadedFamily: face.exactLoaded
          ? face.family
          : (settledCandidate?.family ?? (face.familyLoaded ? face.family : null)),
        loadedStyle: face.exactLoaded ? face.style : (settledCandidate?.style ?? null),
        source: face.exactLoaded || settledCandidate ? (face.resolution.source ?? null) : null
      }
    }),
    glyphFallback: {
      family: null,
      observation: glyphFallbackObservation(check.readiness)
    }
  }
}

function renderReady(check: FontRenderingCheckResult): FontRenderReady {
  if (check.renderStatus === 'effective') return 'ready'
  if (check.renderStatus === 'degraded') return 'degraded'
  if (check.renderStatus === 'pending') return 'pending'
  if (check.renderStatus === 'unverifiable') return 'unverifiable'
  return 'not_ready'
}

function glyphFallbackObservation(
  readiness: NodeFontReadiness
): FontRenderingAuditNode['glyphFallback']['observation'] {
  if (readiness === 'unavailable') return 'unavailable'
  if (readiness === 'pending') return 'pending'
  if (readiness === 'exhausted') return 'unresolved'
  return 'resolved_family_unobservable'
}

function owningPageId(graph: SceneGraph, nodeId: string): string {
  let node = graph.getNode(nodeId)
  const visited = new Set<string>()
  while (node && !visited.has(node.id)) {
    if (node.type === 'CANVAS') return node.id
    visited.add(node.id)
    node = node.parentId ? graph.getNode(node.parentId) : undefined
  }
  return ''
}

function summarize(
  nodes: readonly FontRenderingAuditNode[],
  collected: CollectedFontNodes,
  returnedNodes: number,
  complete: boolean
) {
  const faces = nodes.flatMap((node) => node.faces)
  return {
    complete,
    matchedTextAndButtonLabels: collected.matched,
    matchedCountComplete: !collected.scanLimitReached,
    auditedNodes: nodes.length,
    returnedNodes,
    omittedNodes: Math.max(0, nodes.length - returnedNodes),
    knownUnauditedNodes: Math.max(0, collected.matched - nodes.length),
    scannedSceneNodes: collected.scannedSceneNodes,
    limits: {
      maxAuditedFontNodes: MAX_AUDITED_FONT_NODES,
      maxScannedSceneNodes: MAX_SCANNED_SCENE_NODES,
      auditLimitReached: collected.auditLimitReached,
      scanLimitReached: collected.scanLimitReached
    },
    ready: nodes.filter((node) => node.renderReady === 'ready').length,
    degraded: nodes.filter((node) => node.renderReady === 'degraded').length,
    pending: nodes.filter((node) => node.renderReady === 'pending').length,
    notReady: nodes.filter((node) => node.renderReady === 'not_ready').length,
    unverifiable: nodes.filter((node) => node.renderReady === 'unverifiable').length,
    requestedFaces: faces.length,
    exactFacesLoaded: faces.filter((face) => face.exactLoaded).length,
    synthesizedFaces: faces.filter((face) => face.mode === 'synthesized').length
  }
}

function applyRetryCompleteness(
  retry: FontRetryResult,
  complete: boolean,
  collected: CollectedFontNodes
): FontRetryResult {
  if (complete) return retry
  const scopeReason = collected.scanLimitReached
    ? `The audit stopped after ${MAX_SCANNED_SCENE_NODES} scene nodes; additional font nodes may exist.`
    : `The audit inspected the first ${MAX_AUDITED_FONT_NODES} text/button-label nodes.`
  if (!retry.requested) return { ...retry, complete: false, reason: scopeReason }
  return {
    ...retry,
    status: 'partial',
    complete: false,
    auditedStatus: retry.status === 'partial' ? retry.auditedStatus : retry.status,
    reason: retry.reason ? `${retry.reason} ${scopeReason}` : scopeReason
  }
}

async function retryFontNodes(
  figma: FigmaAPI,
  rawNodes: readonly SceneNode[],
  initial: FontRenderingCheckResult[],
  options: { timeoutMs: number; maxRetries: number; signal?: AbortSignal }
): Promise<{ nodes: FontRenderingCheckResult[]; retry: FontRetryResult }> {
  if (initial.some((node) => node.readiness === 'unavailable')) {
    return {
      nodes: initial,
      retry: {
        requested: true,
        status: 'unverifiable',
        complete: true,
        attempts: 0,
        timeoutMs: options.timeoutMs,
        reason: 'No live CanvasKit renderer is attached to the host.'
      }
    }
  }
  if (!needsRetry(initial)) {
    return {
      nodes: initial,
      retry: {
        requested: true,
        status: 'not_needed',
        complete: true,
        attempts: 0,
        timeoutMs: options.timeoutMs
      }
    }
  }

  const deadline = Date.now() + options.timeoutMs
  let nodes = initial
  let attempts = 0
  while (attempts < options.maxRetries && Date.now() < deadline) {
    options.signal?.throwIfAborted()
    const requestedDemands = requestFontRetries(figma, rawNodes)
    if (requestedDemands === 0) break
    attempts++
    nodes = await waitUntilNotPending(figma, rawNodes, deadline, options.signal)
    if (!needsRetry(nodes)) {
      return {
        nodes,
        retry: {
          requested: true,
          status: 'settled',
          complete: true,
          attempts,
          timeoutMs: options.timeoutMs
        }
      }
    }
    if (nodes.some((node) => node.readiness === 'pending')) break
  }

  nodes = inspectNodes(figma, rawNodes)
  const pending = nodes.some((node) => node.readiness === 'pending')
  const terminal = nodes.some(
    (node) => node.renderStatus === 'failed' || node.renderStatus === 'exhausted'
  )
  let status: FontRetryResult['status'] = 'settled_degraded'
  if (pending) status = attempts === 0 ? 'unverifiable' : 'timed_out'
  else if (terminal) status = 'exhausted'
  return {
    nodes,
    retry: {
      requested: true,
      status,
      complete: true,
      attempts,
      timeoutMs: options.timeoutMs,
      ...(pending
        ? {
            reason:
              attempts === 0
                ? 'The renderer reported pending readiness but exposed no retryable font demand.'
                : 'Font readiness did not settle before timeout_ms.'
          }
        : {})
    }
  }
}

function needsRetry(nodes: readonly FontRenderingCheckResult[]): boolean {
  return nodes.some(
    (node) =>
      node.readiness === 'pending' || node.readiness === 'exhausted' || !node.exactFacesLoaded
  )
}

function requestFontRetries(figma: FigmaAPI, nodes: readonly SceneNode[]): number {
  let requestedDemands = 0
  for (const rawNode of nodes) {
    const result = figma.retryNodeFontReadiness(rawNode.id)
    if (result !== 'unavailable') requestedDemands += result.demandKeys.length
  }
  return requestedDemands
}

async function waitUntilNotPending(
  figma: FigmaAPI,
  nodes: readonly SceneNode[],
  deadline: number,
  signal?: AbortSignal
): Promise<FontRenderingCheckResult[]> {
  let checks = inspectNodes(figma, nodes)
  while (checks.some((node) => node.readiness === 'pending') && Date.now() < deadline) {
    signal?.throwIfAborted()
    await boundedDelay(Math.min(25, Math.max(1, deadline - Date.now())), signal)
    checks = inspectNodes(figma, nodes)
  }
  return checks
}

function boundedDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      const reason = signal?.reason
      reject(reason instanceof Error ? reason : new Error('Font rendering audit aborted'))
    }
    if (!signal) return
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return Math.min(maximum, Math.max(minimum, Math.floor(value ?? fallback)))
}
