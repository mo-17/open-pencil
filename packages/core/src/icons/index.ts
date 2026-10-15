import { throwIfAborted } from '#core/async-work'

import { createIconifyProvider, type IconProvider } from './provider'
import type { IconData, IconSearchResult } from './types'

export {
  createIconifyProvider,
  parseIconName,
  type IconProvider,
  type IconSearchOptions
} from './provider'
export {
  detachIcon,
  iconColor,
  placeIcon,
  recolorIcon,
  swapIcon,
  type PlaceIconOptions
} from './render'
export type { IconCollection, IconData, IconPath, IconSearchResult } from './types'

/** The Iconify icons hosts use unless they pass a provider of their own. */
let defaultProvider = createIconifyProvider()
export const iconify: IconProvider = {
  icons: (...args) => defaultProvider.icons(...args),
  search: (...args) => defaultProvider.search(...args),
  previews: (...args) => defaultProvider.previews(...args),
  collections: () => defaultProvider.collections(),
  browse: (...args) => defaultProvider.browse(...args)
}

/** Clear the default provider for hosts switching credentials or tests. */
export function clearIconCache(): void {
  defaultProvider = createIconifyProvider()
}

export async function fetchIcons(
  names: string[],
  size = 24,
  signal?: AbortSignal
): Promise<Map<string, IconData>> {
  return iconify.icons(names, size, signal)
}

export async function fetchIcon(name: string, size = 24, signal?: AbortSignal): Promise<IconData> {
  throwIfAborted(signal, 'Icon fetch cancelled')
  const icon = (await fetchIcons([name], size, signal)).get(name)
  if (!icon)
    throw new Error(`Icon "${name}" not found. Check the name at https://icon-sets.iconify.design/`)
  return icon
}

export const searchIcons = (query: string, options?: { limit?: number; prefix?: string }) =>
  iconify.search(query, options)

export async function searchIconsBatch(
  queries: string[],
  options?: { limit?: number; prefix?: string }
): Promise<Map<string, IconSearchResult>> {
  return new Map(
    await Promise.all(
      queries.map(async (query) => [query, await iconify.search(query, options)] as const)
    )
  )
}
