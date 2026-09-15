import {
  VIDEO_MODULE_TYPE,
  VIDEO_PLUGIN_ID,
  VR_TOUR_MODULE_TYPE,
  VR_TOUR_PLUGIN_ID
} from '@open-pencil/core/plugins'

import {
  AppBackendProviderBuildError,
  type AppBackendProviderHostStore
} from '@/app/plugins/host/backend-provider'
import { inspectInstalledPluginModuleCompatibility } from '@/app/plugins/modules'
import type { InstalledPluginModule } from '@/app/plugins/types'

import type { BusinessTemplateId } from './model/types'

interface BusinessTemplatePluginStore extends AppBackendProviderHostStore {
  installedModules?(): readonly InstalledPluginModule[]
}

/** Re-resolve current install/key status at every user-facing template mutation boundary. */
export function hasBusinessTemplatePlugins(
  store: BusinessTemplatePluginStore,
  kind: BusinessTemplateId
): boolean {
  const required = requiredBusinessModule(kind)
  if (!required) return true
  const module = store
    .installedModules?.()
    .find(
      (entry) =>
        entry.plugin.package.trustSource === 'app-bundle' &&
        entry.plugin.package.manifest.plugin.id === required.pluginId &&
        entry.contribution.moduleType === required.moduleType
    )
  return Boolean(module && inspectInstalledPluginModuleCompatibility(module).ok)
}

function requiredBusinessModule(kind: BusinessTemplateId) {
  if (kind === 'rental-viewing')
    return {
      pluginId: VR_TOUR_PLUGIN_ID,
      moduleType: VR_TOUR_MODULE_TYPE,
      message:
        'Install and enable OpenPencil VR Tour in Settings → Plugins before creating the rental template. 请先在设置 → 插件中安装并启用 VR 看房。'
    }
  if (kind === 'video-live')
    return {
      pluginId: VIDEO_PLUGIN_ID,
      moduleType: VIDEO_MODULE_TYPE,
      message:
        'Install and enable Video in Settings → Plugins before creating the video and live template. 请先在设置 → 插件中安装并启用视频插件。'
    }
  return undefined
}

export function requireBusinessTemplatePlugins(
  store: BusinessTemplatePluginStore,
  kind: BusinessTemplateId
): void {
  if (!hasBusinessTemplatePlugins(store, kind))
    throw new AppBackendProviderBuildError(
      'request-invalid',
      requiredBusinessModule(kind)?.message ??
        'The required business template plugin is unavailable.'
    )
}
