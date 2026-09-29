import type { JSONObject } from '@open-pencil/scene-graph/primitives'

export interface TreeItem extends JSONObject {
  id: string
  label: string
  parentId: string
  disabled: boolean
}
export interface TreeModuleConfigV1 extends JSONObject {
  presentation: 'tree' | 'select'
  label: string
  placeholder: string
  items: TreeItem[]
  selectionMode: 'single' | 'multiple'
  initialSelectedIds: string[]
  initialExpandedIds: string[]
  searchable: boolean
  disabled: boolean
  showValue: boolean
  backgroundColor: string
  textColor: string
  accentColor: string
  borderColor: string
  fontSize: number
  rowHeight: number
}
export const TREE_MODULE_LIMITS = Object.freeze({
  items: 128,
  depth: 6,
  label: 120,
  configBytes: 49152
})
export interface TreeRow {
  item: TreeItem
  level: number
  disabled: boolean
  hasChildren: boolean
  expanded: boolean
  position: number
  size: number
}
/** Flatten only visible branches. Search keeps matching nodes and their ancestors. */
export function treeVisibleRows(
  config: TreeModuleConfigV1,
  expanded = config.initialExpandedIds,
  query = ''
): TreeRow[] {
  const byId = new Map(config.items.map((item) => [item.id, item]))
  const matches = new Set<string>()
  const needle = query.trim().toLocaleLowerCase()
  if (needle)
    for (const item of config.items) {
      if (!item.label.toLocaleLowerCase().includes(needle)) continue
      let current: TreeItem | undefined = item
      while (current && !matches.has(current.id)) {
        matches.add(current.id)
        current = byId.get(current.parentId)
      }
    }
  const rows: TreeRow[] = []
  function visit(parentId: string, level: number, disabled: boolean): void {
    const children = config.items.filter(
      (item) => item.parentId === parentId && (!needle || matches.has(item.id))
    )
    children.forEach((item, index) => {
      const hasChildren = config.items.some((child) => child.parentId === item.id)
      const open = hasChildren && (Boolean(needle) || expanded.includes(item.id))
      const inactive = disabled || item.disabled || config.disabled
      rows.push({
        item,
        level,
        disabled: inactive,
        hasChildren,
        expanded: open,
        position: index + 1,
        size: children.length
      })
      if (open) visit(item.id, level + 1, inactive)
    })
  }
  visit('', 1, false)
  return rows
}
export function treeItemDisabled(items: readonly TreeItem[], id: string): boolean {
  const byId = new Map(items.map((item) => [item.id, item]))
  let current = byId.get(id)
  for (let depth = 0; current && depth < TREE_MODULE_LIMITS.depth; depth++) {
    if (current.disabled) return true
    current = byId.get(current.parentId)
  }
  return false
}
