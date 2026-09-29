import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { resolveTabsModule, type TabsModuleConfig } from '#core/plugins/tabs'

interface TabsContentGraph {
  getChildren(id: string): SceneNode[]
}

export interface TabsPreviewGeometry {
  header: Rect
  body: Rect
  content: Rect
  tabHeight: number
}

export interface TabsContentProjection extends TabsPreviewGeometry {
  config: TabsModuleConfig
  panels: SceneNode[]
  activeChildId: string | null
}

/** The same panel viewport is used by derived layout, painting and pointer input. */
export function tabsPreviewGeometry(
  node: Pick<SceneNode, 'width' | 'height'>,
  config: TabsModuleConfig
): TabsPreviewGeometry {
  const width = Math.max(0, node.width)
  const height = Math.max(0, node.height)
  const buttonHeight = Math.ceil(config.fontSize * 1.3) + 16
  const divider = config.showDivider ? 1 : 0
  const header: Rect =
    config.orientation === 'horizontal'
      ? { x: 0, y: 0, width, height: Math.min(height, buttonHeight + 16 + divider) }
      : { x: 0, y: 0, width: Math.min(width * 0.42, Math.max(112, width * 0.3)), height }
  const body: Rect =
    config.orientation === 'horizontal'
      ? { x: 0, y: header.height, width, height: Math.max(0, height - header.height) }
      : { x: header.width, y: 0, width: Math.max(0, width - header.width), height }
  return {
    header,
    body,
    content: {
      x: body.x + 16,
      y: body.y + 16,
      width: Math.max(0, body.width - 32),
      height: Math.max(0, body.height - 32)
    },
    tabHeight: buttonHeight
  }
}

/** Explicit slots follow the compiler's unique direct-child-name contract.
 * Invalid and unassigned layers remain editable data, never substituted content.
 * Legacy Tabs without explicit slots retain their ordinary child rendering. */
export function resolveTabsContent(
  graph: TabsContentGraph,
  node: SceneNode
): TabsContentProjection | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveTabsModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config } = resolved
  if (!config.tabs.some((tab) => typeof tab.contentChildName === 'string')) return null
  const children = graph.getChildren(node.id)
  const panels: SceneNode[] = []
  let activeChildId: string | null = null
  for (const tab of config.tabs) {
    const name = tab.contentChildName
    if (!name || config.tabs.filter((item) => item.contentChildName === name).length !== 1) continue
    const matches = children.filter((child) => child.name === name)
    if (matches.length !== 1 || matches[0].internalOnly) continue
    const child = matches[0]
    panels.push(child)
    if (tab.id === config.initialTabId && child.visible) activeChildId = child.id
  }
  return { ...tabsPreviewGeometry(node, config), config, panels, activeChildId }
}
