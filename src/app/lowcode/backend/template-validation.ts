import {
  parseBackendResourceDataSource,
  validateBackendClientAction,
  validateBackendResourceDataSource,
  type BackendApplicationSpecV1,
  type BackendDiagnostic
} from '@open-pencil/lowcode/backend'
import type { ActionDef, SceneNode, DocumentStateDef, SceneGraph } from '@open-pencil/scene-graph'

import { BackendDraftOperationError } from '@/app/lowcode/backend/draft'

export function validateBackendTemplatePages(ctx: {
  editor: { graph: SceneGraph }
  application: BackendApplicationSpecV1
  docStates: readonly DocumentStateDef[]
  pageIds: readonly string[]
}): void {
  const diagnostics: BackendDiagnostic[] = []
  const action = (entry: ActionDef) => {
    if (
      entry.kind === 'backendAuth' ||
      entry.kind === 'backendRequest' ||
      entry.kind === 'backendCommand' ||
      entry.kind === 'backendCommandRecovery'
    )
      diagnostics.push(...validateBackendClientAction(ctx.application, entry, ctx.docStates))
    if ('consequent' in entry) entry.consequent.forEach(action)
    if ('alternate' in entry) entry.alternate?.forEach(action)
    if ('onSuccess' in entry) entry.onSuccess?.forEach(action)
    if ('onError' in entry) entry.onError?.forEach(action)
  }
  const visit = (node: SceneNode) => {
    Object.values(node.events ?? {})
      .flat()
      .forEach(action)
    const source = node.interactiveProps?.dataSourceRef
    if (source) {
      const parsed = parseBackendResourceDataSource(source)
      diagnostics.push(
        ...(parsed.ok
          ? validateBackendResourceDataSource(ctx.application, parsed.value, ctx.docStates)
          : parsed.diagnostics)
      )
    }
    for (const child of ctx.editor.graph.getChildren(node.id)) visit(child)
  }
  for (const id of ctx.pageIds) {
    const node = ctx.editor.graph.getNode(id)
    if (node) visit(node)
  }
  if (diagnostics.length)
    throw new BackendDraftOperationError(diagnostics.map((entry) => entry.message).join(' '))
}
