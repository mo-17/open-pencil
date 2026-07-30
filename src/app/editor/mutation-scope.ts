import type { Editor } from '@open-pencil/core/editor'

export interface EditorMutationScope {
  pageId: string
  scope: 'document' | 'page'
}

export function resolveEditorMutationScope(
  store: Editor,
  args: Record<string, unknown>,
  options: { forceDocument?: boolean } = {}
): EditorMutationScope {
  const currentPageId = store.state.currentPageId
  const structuralTargetId = resolveStructuralTargetId(args)
  const structuralTarget = structuralTargetId ? store.graph.getNode(structuralTargetId) : undefined
  if (
    options.forceDocument ||
    structuralTarget?.type === 'CANVAS' ||
    structuralTarget?.id === store.graph.rootId
  ) {
    return { pageId: currentPageId, scope: 'document' }
  }

  const pageIds = new Set<string>()
  collectReferencedPageIds(store, args, pageIds)
  if (pageIds.size > 1) return { pageId: currentPageId, scope: 'document' }
  return { pageId: pageIds.values().next().value ?? currentPageId, scope: 'page' }
}

function collectReferencedPageIds(
  store: Editor,
  value: unknown,
  pageIds: Set<string>,
  seen = new WeakSet<object>()
): void {
  if (typeof value === 'string') {
    const pageId = pageIdForNode(store, value)
    if (pageId) pageIds.add(pageId)
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        collectReferencedPageIds(store, JSON.parse(trimmed), pageIds, seen)
      } catch (error) {
        // Ordinary text values can begin with JSON punctuation.
        if (!(error instanceof SyntaxError)) throw error
      }
    }
    return
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectReferencedPageIds(store, item, pageIds, seen)
    return
  }
  for (const item of Object.values(value)) {
    collectReferencedPageIds(store, item, pageIds, seen)
  }
}

function resolveStructuralTargetId(args: Record<string, unknown>): string | undefined {
  if (typeof args.id === 'string') return args.id
  return typeof args.replace_id === 'string' ? args.replace_id : undefined
}

export function pageIdForNode(store: Editor, nodeId: string): string | undefined {
  let node = store.graph.getNode(nodeId)
  while (node) {
    if (node.type === 'CANVAS') return node.id
    node = node.parentId ? store.graph.getNode(node.parentId) : undefined
  }
  return undefined
}
