import {
  EFFECT_PICK_CATALOG,
  EFFECT_PICK_MODULE_TYPE,
  EFFECT_PICK_PLUGIN_ID,
  getEffectPickCatalogEntry
} from '@open-pencil/core/plugins'

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

export function pluginAssetKey(module: InstalledPluginModule, effectId?: string): string {
  return JSON.stringify([
    'plugin',
    module.plugin.package.manifest.plugin.id,
    module.contribution.moduleType,
    ...(effectId ? [effectId] : [])
  ])
}

export interface ModuleAssetVariant {
  readonly module: InstalledPluginModule
  readonly effectId?: string
  readonly name?: string
  readonly description?: string
  readonly tags?: readonly string[]
}

function isBundledEffectPickModule(module: InstalledPluginModule): boolean {
  return (
    module.plugin.package.trustSource === 'app-bundle' &&
    module.plugin.package.manifest.plugin.id === EFFECT_PICK_PLUGIN_ID &&
    module.contribution.moduleType === EFFECT_PICK_MODULE_TYPE
  )
}

export function moduleAssetVariants(module: InstalledPluginModule): readonly ModuleAssetVariant[] {
  return isBundledEffectPickModule(module)
    ? EFFECT_PICK_CATALOG.map((effect) => ({
        module,
        effectId: effect.id,
        name: effect.title,
        description: effect.description,
        tags: effect.tags
      }))
    : [{ module }]
}

/** Select only a reviewed bundled artifact; callers cannot supply source, digest or paths. */
export function effectPickAssetModule(
  module: InstalledPluginModule,
  effectId: string
): InstalledPluginModule {
  const effect = getEffectPickCatalogEntry(effectId)
  if (!isBundledEffectPickModule(module) || !effect)
    throw new TypeError('The selected EffectPick asset is unavailable')
  return {
    plugin: module.plugin,
    contribution: {
      ...module.contribution,
      name: effect.title,
      description: effect.description,
      defaultSize: { ...effect.defaultSize },
      defaultConfig: { ...effect.defaultConfig }
    }
  }
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
