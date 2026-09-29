import type { SceneNode } from '@open-pencil/scene-graph'

import { resolveTabsModule } from '#core/plugins/tabs'

/** A view-local choice, excluded from authored module configuration and document serialization. */
export interface TabsTabPreview {
  nodeId: string
  tabId: string
}

export function tabsPreviewNode(node: SceneNode, preview?: TabsTabPreview | null): SceneNode {
  if (!preview || preview.nodeId !== node.id || node.type !== 'FRAME') return node
  const module = node.interactiveProps?.module
  const resolved = resolveTabsModule(module)
  if (!module || !resolved?.ok || !resolved.config.tabs.some((tab) => tab.id === preview.tabId))
    return node
  return {
    ...node,
    interactiveProps: {
      ...node.interactiveProps,
      module: { ...module, config: { ...resolved.config, initialTabId: preview.tabId } }
    }
  }
}
