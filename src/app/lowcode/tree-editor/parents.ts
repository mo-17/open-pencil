import type { TreeItem } from '@open-pencil/core/plugins'

import { treeDescendants } from './index'

/** Reka Select reserves the empty value. Keep this UI encoding out of saved parent IDs. */
export function treeParentValue(parentId: string): string {
  return parentId === '' ? 'root' : `node:${parentId}`
}

export function treeParentId(value: string): string | undefined {
  if (value === 'root') return ''
  return value.startsWith('node:') && value.length > 5 ? value.slice(5) : undefined
}

export function treeParentChoices(items: readonly TreeItem[], id: string, rootLabel: string) {
  const excluded = treeDescendants(items, id)
  const seen = new Set<string>()
  const choices = [{ value: treeParentValue(''), label: rootLabel }]
  for (const item of items) {
    // Invalid in-progress IDs remain editable, without duplicating Select item keys.
    if (!item.id || excluded.has(item.id) || seen.has(item.id)) continue
    seen.add(item.id)
    choices.push({ value: treeParentValue(item.id), label: `${item.label} (${item.id})` })
  }
  return choices
}
