import type { SceneNode } from '@open-pencil/scene-graph'

import { resolveModalModule } from '#core/plugins/modal'
import { resolvePopoverModule } from '#core/plugins/popover'

/** Dialog and popover slots share hidden content, including unmatched children.
 * Legacy v1 configs without the field retain their authored trigger children. */
export function modalHidesContent(node: SceneNode): boolean {
  if (node.type !== 'FRAME') return false
  const resolved =
    resolveModalModule(node.interactiveProps?.module) ??
    resolvePopoverModule(node.interactiveProps?.module)
  return resolved?.ok === true && Object.hasOwn(resolved.config, 'contentChildName')
}

/** A dialog or popover body is the uniquely named direct child used by the compiler. */
export function resolveModalContent(
  graph: { getChildren(id: string): SceneNode[] },
  node: SceneNode
): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved =
    resolveModalModule(node.interactiveProps?.module) ??
    resolvePopoverModule(node.interactiveProps?.module)
  if (!resolved?.ok || !resolved.config.contentChildName) return null
  const children = graph
    .getChildren(node.id)
    .filter((child) => child.name === resolved.config.contentChildName)
  return children.length === 1 && !children[0].internalOnly ? children[0] : null
}
