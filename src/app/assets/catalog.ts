import type { InstalledPluginModule } from '@/app/plugins'

export type AssetSource = 'all' | 'local' | 'library' | 'plugin' | 'template'
export type AssetCategory =
  | 'all'
  | 'components'
  | 'navigation'
  | 'content'
  | 'data'
  | 'media'
  | 'input'
  | 'feedback'

const MODULE_CATEGORIES: Record<string, Exclude<AssetCategory, 'all'>> = {
  'slide-menu': 'navigation',
  'dropdown-menu': 'navigation',
  tabs: 'navigation',
  accordion: 'content',
  'rich-text': 'content',
  markdown: 'content',
  html: 'content',
  'code-block': 'content',
  table: 'data',
  'data-grid': 'data',
  chart: 'data',
  map: 'data',
  video: 'media',
  'audio-player': 'media',
  'pdf-viewer': 'media',
  'vr-tour': 'media',
  carousel: 'media',
  lottie: 'media',
  'qr-barcode': 'content',
  'upload-button': 'input',
  modal: 'feedback'
}

export function moduleAssetCategory(moduleType: string): Exclude<AssetCategory, 'all'> {
  return MODULE_CATEGORIES[moduleType] ?? 'components'
}

export function pluginAssetKey(module: InstalledPluginModule): string {
  return JSON.stringify([
    'plugin',
    module.plugin.package.manifest.plugin.id,
    module.contribution.moduleType
  ])
}

export function componentAssetKey(
  documentKey: string,
  id: string,
  libraryId: string | null,
  assetKey: string | null
): string {
  return libraryId && assetKey
    ? JSON.stringify(['library', libraryId, assetKey])
    : JSON.stringify(['local', documentKey, id])
}

export function matchesAssetQuery(
  query: string,
  ...values: (string | null | undefined)[]
): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  const haystack = values.filter(Boolean).join(' ').toLocaleLowerCase()
  return terms.every((term) => haystack.includes(term))
}
