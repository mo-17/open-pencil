import type { ComponentTemplateItem } from '@/app/lowcode/component-templates'

import { matchesAssetQuery, type AssetCategory, type AssetSource } from './catalog'

export type ComponentTemplateKindFilter = 'all' | ComponentTemplateItem['kind']

export interface ComponentTemplateAssetFilter {
  readonly source: AssetSource
  readonly category: AssetCategory
  readonly kind: ComponentTemplateKindFilter
  readonly query: string
  readonly favoritesOnly: boolean
  readonly favorites: ReadonlySet<string>
}

/** Stable local preference identity; a favorite never grants a module permission. */
export function componentTemplateAssetKey(id: ComponentTemplateItem['id']): string {
  return JSON.stringify(['template', id])
}

export function filterComponentTemplateAssets(
  items: readonly ComponentTemplateItem[],
  filter: ComponentTemplateAssetFilter
): readonly ComponentTemplateItem[] {
  if (filter.source !== 'all' && filter.source !== 'template') return []
  return items.filter((item) => {
    if (filter.category !== 'all' && filter.category !== item.category) return false
    if (filter.source === 'template' && filter.kind !== 'all' && filter.kind !== item.kind)
      return false
    if (filter.favoritesOnly && !filter.favorites.has(componentTemplateAssetKey(item.id)))
      return false
    return matchesAssetQuery(
      filter.query,
      item.id,
      item.name,
      item.description,
      ...item.keywords,
      ...item.targets
    )
  })
}
