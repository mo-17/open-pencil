import type { IRTree } from '#compiler/ir/types'

import { escapeAttr } from './shared'

export function pageRootAttrs(ir: IRTree, devMode: boolean, requestGate: boolean): string {
  const attrs = [`class="min-h-screen"`]
  if (devMode) attrs.push(`data-node-id="${escapeAttr(ir.pageId)}"`)
  if (requestGate) {
    attrs.push(
      `:aria-busy="__opPendingRequests.size > 0"`,
      `:data-op-request-pending="__opPendingRequests.size > 0 ? 'true' : undefined"`
    )
  }
  return ` ${attrs.join(' ')}`
}

export function componentRootAttrs(
  componentId: string,
  devMode: boolean,
  requestGate: boolean
): string {
  const attrs: string[] = []
  if (devMode) attrs.push(`data-node-id="${escapeAttr(componentId)}"`)
  if (requestGate) {
    attrs.push(
      `:aria-busy="__opPendingRequests.size > 0"`,
      `:data-op-request-pending="__opPendingRequests.size > 0 ? 'true' : undefined"`
    )
  }
  return attrs.length > 0 ? ` ${attrs.join(' ')}` : ''
}
