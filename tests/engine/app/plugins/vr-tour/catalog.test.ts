import { describe, expect, test } from 'bun:test'

import { VR_TOUR_MODULE_TYPE, VR_TOUR_PLUGIN_ID } from '@open-pencil/core/plugins'

import { requireBusinessTemplatePlugins } from '@/app/lowcode/backend/business/plugins'
import { createBundledPluginCatalog } from '@/app/plugins/catalog'
import { inspectPluginModuleCompatibility } from '@/app/plugins/modules'
import { createMemoryAppPluginStateStorage } from '@/app/plugins/storage/memory'
import { createAppPluginStore } from '@/app/plugins/store'

describe('VR bundled module and rental dependency', () => {
  test('uses a reviewed opt-in adapter', () => {
    const entry = createBundledPluginCatalog().find(
      (item) => item.manifest.plugin.id === VR_TOUR_PLUGIN_ID
    )
    if (!entry) throw new Error('VR plugin missing')
    expect(entry.installedByDefault).toBeUndefined()
    expect(entry.enabledByDefault).toBeUndefined()
    const module = entry.manifest.contributions.modules[0]
    expect(module.moduleType).toBe(VR_TOUR_MODULE_TYPE)
    expect(inspectPluginModuleCompatibility(VR_TOUR_PLUGIN_ID, module).ok).toBe(true)
  })

  test('rechecks installation and disablement before rental module creation', async () => {
    const store = createAppPluginStore({
      catalog: createBundledPluginCatalog(),
      storage: createMemoryAppPluginStateStorage(),
      activationCompatibilityPolicy: () => ({ ok: true }),
      engineVersion: '0.15.0'
    })
    await store.load()
    expect(() => requireBusinessTemplatePlugins(store, 'customer-crm')).not.toThrow()
    expect(() => requireBusinessTemplatePlugins(store, 'rental-viewing')).toThrow(
      'Install and enable'
    )
    await store.install(VR_TOUR_PLUGIN_ID)
    await store.setEnabled(VR_TOUR_PLUGIN_ID, true)
    expect(() => requireBusinessTemplatePlugins(store, 'rental-viewing')).not.toThrow()
    await store.setEnabled(VR_TOUR_PLUGIN_ID, false)
    expect(() => requireBusinessTemplatePlugins(store, 'rental-viewing')).toThrow(
      'Install and enable'
    )
  })
})
