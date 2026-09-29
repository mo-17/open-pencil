import type { IRAttrValue, IRModule } from '#compiler/ir/types'

import type { SceneNode } from '@open-pencil/scene-graph'

/** Preserve authored language for the reviewed content runtimes' local UI copy. */
export function collectContentModuleLanguage(
  node: SceneNode,
  module: IRModule | null,
  attrs: Record<string, IRAttrValue>
): void {
  if (
    !module ||
    !['markdown', 'code-block', 'date-range', 'tree', 'popover', 'walktour', 'slider', 'rating', 'cascader'].includes(
      module.moduleType
    ) ||
    module.pluginId !== 'open-pencil.' + module.moduleType
  )
    return
  const language = node.interactiveProps?.lang
  if (typeof language === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(language))
    attrs.lang = language
}
