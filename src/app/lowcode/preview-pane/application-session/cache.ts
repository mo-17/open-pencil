import {
  deriveLowcodePageRoutes,
  lowcodeRouteMatches,
  resolveLowcodeApplicationPages
} from '@open-pencil/lowcode'
import type { SceneGraph, StateValueType } from '@open-pencil/scene-graph'

import { applicationStateDeclarations } from '../application-state'
import type { PreviewTarget } from '../host/types'
import {
  parsePreviewPageSessionSnapshot,
  type PreviewPageSessionSnapshot
} from '../iframe/messages'

interface PageSessionAuthority {
  route: string
  types: Map<string, StateValueType>
}

function guardDeclarations(graph: SceneGraph, pageIds: readonly string[]) {
  const signatures: unknown[] = []
  for (const pageId of pageIds) {
    const node = graph.getNode(pageId)
    const policy = node?.lowcodeApplicationPage
    if (!policy?.enterGuard && !policy?.leaveConfirm) continue
    const inputs = policy.leaveConfirm
      ? applicationStateDeclarations(node?.state ?? [], 'include')
      : null
    if (policy.leaveConfirm && !inputs) return null
    signatures.push([
      pageId,
      policy.enterGuard ?? null,
      policy.leaveConfirm ?? null,
      inputs?.signature ?? null
    ])
  }
  if (!signatures.length) return { signatures, documents: null }
  const documents = applicationStateDeclarations(
    graph.getNode(graph.rootId)?.lowcodeDocumentState ?? [],
    'include'
  )
  return documents ? { signatures, documents: documents.signature } : null
}

function declarations(graph: SceneGraph) {
  const scope = resolveLowcodeApplicationPages(graph)
  if (scope.mode !== 'application' || scope.warnings.length) return null
  const routes = deriveLowcodePageRoutes(
    scope.pages.flatMap(({ pageId }) => {
      const node = graph.getNode(pageId)
      return node
        ? [
            {
              pageId,
              pageName: node.name,
              ...(node.lowcodeRoutePattern ? { routePattern: node.lowcodeRoutePattern } : {})
            }
          ]
        : []
    })
  )
  const guards = guardDeclarations(
    graph,
    scope.pages.map(({ pageId }) => pageId)
  )
  if (!guards) return null
  const pages = new Map<string, PageSessionAuthority>()
  const signatures: unknown[] = []
  for (const page of scope.pages) {
    const node = graph.getNode(page.pageId)
    if (page.stateRetention !== 'preserve') continue
    const state = applicationStateDeclarations(node?.state ?? [], true)
    const route = routes.find((entry) => entry.pageId === page.pageId)?.route
    if (!state || !route) return null
    pages.set(page.pageId, { route, types: state.types })
    signatures.push([page.pageId, page.entryNodeId, route, state.signature])
  }
  if (!guards.signatures.length)
    return { pages, signature: JSON.stringify(signatures), hasGuards: false }
  return {
    pages,
    signature: JSON.stringify([signatures, guards.signatures, guards.documents]),
    hasGuards: true
  }
}

/** Capture navigation/session policy alongside the compiler snapshot, before async completion. */
export function applicationPageSessionSignature(graph: SceneGraph): string | null {
  try {
    const declaration = declarations(graph)
    return declaration && (declaration.pages.size || declaration.hasGuards)
      ? declaration.signature
      : null
  } catch {
    return null
  }
}

function valueMatches(type: StateValueType, value: unknown): boolean {
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  return typeof value === type
}

/** Local preview recovery only; never persisted or sent to collaboration peers. */
export function createApplicationPageSessionCache() {
  let graphOwner: SceneGraph | null = null
  let targetOwner: PreviewTarget | null = null
  let signatureOwner: string | null = null
  let pages = new Map<string, PageSessionAuthority>()
  let sessionAuthority: object | null = null
  let stored: PreviewPageSessionSnapshot = { version: 1, entries: [] }

  function clear(): void {
    graphOwner = null
    targetOwner = null
    signatureOwner = null
    sessionAuthority = null
    pages.clear()
    stored = { version: 1, entries: [] }
  }

  function synchronize(graph: SceneGraph, target: PreviewTarget): boolean {
    try {
      const next = declarations(graph)
      if (!next || next.pages.size === 0) {
        clear()
        return false
      }
      if (graphOwner !== graph || targetOwner !== target || signatureOwner !== next.signature) {
        clear()
        graphOwner = graph
        targetOwner = target
        signatureOwner = next.signature
        sessionAuthority = Object.freeze({})
      }
      pages = next.pages
      return true
    } catch {
      clear()
      return false
    }
  }

  function authority(
    graph: SceneGraph,
    target: PreviewTarget,
    sourceSignature?: string | null
  ): object | null {
    if (!synchronize(graph, target)) return null
    if (sourceSignature !== undefined && sourceSignature !== signatureOwner) return null
    return sessionAuthority
  }

  function accept(
    graph: SceneGraph,
    target: PreviewTarget,
    value: unknown,
    frameAuthority: object | null
  ): boolean {
    if (!synchronize(graph, target) || !frameAuthority || frameAuthority !== sessionAuthority)
      return false
    const snapshot = parsePreviewPageSessionSnapshot(value)
    // Oversized or malformed replacements must not leave an old snapshot available for replay.
    stored = { version: 1, entries: [] }
    if (!snapshot) return false
    for (const entry of snapshot.entries) {
      const authority = pages.get(entry.pageId)
      if (!authority || !lowcodeRouteMatches(authority.route, entry.pathname)) continue
      entry.values = Object.fromEntries(
        Object.entries(entry.values).filter(([name, state]) => {
          const type = authority.types.get(name)
          return type !== undefined && valueMatches(type, state)
        })
      )
      stored.entries.push(entry)
    }
    return true
  }

  function snapshot(graph: SceneGraph, target: PreviewTarget): PreviewPageSessionSnapshot {
    if (!synchronize(graph, target)) return { version: 1, entries: [] }
    return structuredClone(stored)
  }

  return { accept, authority, synchronize, snapshot, clear }
}
