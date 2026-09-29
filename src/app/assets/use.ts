import { useStore } from '@nanostores/vue'
import { useEventListener } from '@vueuse/core'
import { computed, ref, shallowRef } from 'vue'

import { locale as appLocale, usePanelMessages, useDialogMessages } from '@open-pencil/vue'

import { readLocalStorageText, writeLocalStorageText } from '@/app/cache'
import { useEditorStore } from '@/app/editor/active-store'
import {
  ComponentTemplateError,
  componentTemplateAvailability,
  getComponentTemplates,
  insertComponentTemplate,
  type ComponentTemplateId
} from '@/app/lowcode/component-templates'
import {
  appPluginStore,
  appPluginStoreSnapshot,
  inspectInstalledPluginModuleCompatibility,
  type InstalledPluginModule
} from '@/app/plugins'
import {
  localizedAppPluginContributionText,
  localizedAppPluginText
} from '@/app/plugins/localization'

import {
  matchesAssetQuery,
  moduleAssetCategory,
  pluginAssetKey,
  type AssetCategory,
  type AssetSource
} from './catalog'
import {
  filterComponentTemplateAssets,
  type ComponentTemplateKindFilter
} from './component-templates'
import { ASSET_FAVORITES_STORAGE_KEY, createAssetFavorites } from './favorites'
import { insertModuleAsset } from './module-insertion'

export function useAssetWorkbench() {
  const editor = useEditorStore()
  const panels = usePanelMessages()
  const dialogs = useDialogMessages()
  const locale = useStore(appLocale)
  const query = ref('')
  const source = ref<AssetSource>('all')
  const category = ref<AssetCategory>('all')
  const templateKind = ref<ComponentTemplateKindFilter>('all')
  const favoritesOnly = ref(false)
  const error = ref('')
  const notice = ref('')
  const busyModule = ref('')
  const busyTemplate = ref('')
  const favoritesStore = createAssetFavorites({
    getItem: readLocalStorageText,
    setItem(key, value) {
      writeLocalStorageText(key, value)
      if (readLocalStorageText(key) !== value) throw new Error('Asset preferences were not saved')
    }
  })
  const favorites = shallowRef(favoritesStore.load())
  useEventListener('storage', (event) => {
    if (event.key === ASSET_FAVORITES_STORAGE_KEY || event.key === null)
      favorites.value = favoritesStore.load()
  })
  function toggleFavorite(key: string) {
    favorites.value = favoritesStore.toggle(key)
  }
  function moduleName(module: InstalledPluginModule) {
    return (
      localizedAppPluginContributionText(
        module.plugin.package.manifest.plugin.id,
        module.contribution.moduleType,
        locale.value
      )?.name ?? module.contribution.name
    )
  }
  const modules = computed(() => {
    if (!appPluginStoreSnapshot.value.ready) return []
    return appPluginStore
      .installedModules()
      .filter((module) => inspectInstalledPluginModuleCompatibility(module).ok)
      .map((module) => {
        const pluginId = module.plugin.package.manifest.plugin.id
        const localized = localizedAppPluginContributionText(
          pluginId,
          module.contribution.moduleType,
          locale.value
        )
        return {
          module,
          key: pluginAssetKey(module),
          name: moduleName(module),
          description: localized?.description ?? module.contribution.description,
          pluginName:
            localizedAppPluginText(pluginId, locale.value)?.name ??
            module.plugin.package.manifest.plugin.name,
          category: moduleAssetCategory(module.contribution.moduleType)
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, locale.value))
  })
  const filteredModules = computed(() =>
    source.value !== 'all' && source.value !== 'plugin'
      ? []
      : modules.value.filter(
          (item) =>
            (category.value === 'all' || category.value === item.category) &&
            (!favoritesOnly.value || favorites.value.keys.has(item.key)) &&
            matchesAssetQuery(query.value, item.name, item.description, item.pluginName)
        )
  )
  const filteredTemplates = computed(() => {
    // Availability changes when modules are enabled, disabled, installed or replaced.
    void appPluginStoreSnapshot.value
    return filterComponentTemplateAssets(getComponentTemplates(locale.value), {
      source: source.value,
      category: category.value,
      kind: templateKind.value,
      query: query.value,
      favoritesOnly: favoritesOnly.value,
      favorites: favorites.value.keys
    }).map((template) => ({
      template,
      availability: componentTemplateAvailability(template.id)
    }))
  })
  const sourceOptions = computed(() => [
    { value: 'all' as const, label: panels.value.assetSourceAll },
    { value: 'local' as const, label: panels.value.assetSourceLocal },
    { value: 'library' as const, label: panels.value.assetSourceLibrary },
    { value: 'plugin' as const, label: panels.value.assetSourcePlugin },
    { value: 'template' as const, label: panels.value.assetSourceTemplate }
  ])
  const templateKindOptions = computed(() => [
    { value: 'all' as const, label: panels.value.assetTemplateAll },
    { value: 'basic' as const, label: panels.value.assetTemplateBasic },
    { value: 'combination' as const, label: panels.value.assetTemplateCombination }
  ])
  const categoryOptions = computed(() => [
    { value: 'all' as const, label: panels.value.assetCategoryAll },
    { value: 'components' as const, label: panels.value.assetCategoryComponents },
    { value: 'navigation' as const, label: panels.value.assetCategoryNavigation },
    { value: 'content' as const, label: panels.value.assetCategoryContent },
    { value: 'data' as const, label: panels.value.assetCategoryData },
    { value: 'media' as const, label: panels.value.assetCategoryMedia },
    { value: 'input' as const, label: panels.value.assetCategoryInput },
    { value: 'feedback' as const, label: panels.value.assetCategoryFeedback }
  ])
  async function insertModule(module: InstalledPluginModule) {
    if (busyModule.value || busyTemplate.value) return
    busyModule.value = pluginAssetKey(module)
    error.value = ''
    notice.value = ''
    try {
      await insertModuleAsset(editor, module, locale.value, panels.value.assetTargetChanged)
      notice.value = panels.value.assetInsertedHint
    } catch (cause) {
      error.value = dialogs.value.pluginOperationFailed({
        error: cause instanceof Error ? cause.message : String(cause)
      })
    } finally {
      busyModule.value = ''
    }
  }
  function insertTemplate(id: ComponentTemplateId) {
    if (busyModule.value || busyTemplate.value) return
    busyTemplate.value = id
    error.value = ''
    notice.value = ''
    try {
      insertComponentTemplate(editor, id, locale.value)
      notice.value = panels.value.assetInsertedHint
    } catch (cause) {
      const messages = {
        'unknown-template': panels.value.assetTemplateUnknown,
        'unavailable-module': panels.value.assetTemplateUnavailable,
        'invalid-target': panels.value.assetTemplateInvalidTarget
      }
      error.value =
        cause instanceof ComponentTemplateError
          ? messages[cause.code]
          : panels.value.assetTemplateFailed
    } finally {
      busyTemplate.value = ''
    }
  }
  function clearFilters() {
    query.value = ''
    source.value = 'all'
    category.value = 'all'
    favoritesOnly.value = false
    templateKind.value = 'all'
  }
  return {
    query,
    source,
    category,
    favoritesOnly,
    favorites,
    toggleFavorite,
    filteredModules,
    filteredTemplates,
    templateKind,
    templateKindOptions,
    sourceOptions,
    categoryOptions,
    insertModule,
    busyModule,
    busyTemplate,
    insertTemplate,
    clearFilters,
    error,
    notice
  }
}
