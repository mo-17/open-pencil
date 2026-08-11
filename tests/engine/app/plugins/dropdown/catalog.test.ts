import { describe, expect, test } from 'bun:test'

import {
  DROPDOWN_MENU_MODULE_CONFIG_VERSION,
  DROPDOWN_MENU_MODULE_DEFAULT_CONFIG,
  DROPDOWN_MENU_MODULE_TYPE,
  DROPDOWN_MENU_PLUGIN_ID
} from '@open-pencil/core/plugins'

import { createBundledPluginCatalog } from '@/app/plugins/catalog'

describe('Dropdown Menu bundled catalog entry', () => {
  test('publishes the exact reviewed adapter and stays opt-in by default', () => {
    const entry = createBundledPluginCatalog().find(
      (candidate) => candidate.manifest.plugin.id === DROPDOWN_MENU_PLUGIN_ID
    )
    const contribution = entry?.manifest.contributions.modules[0]

    expect(entry?.installedByDefault).toBeUndefined()
    expect(entry?.enabledByDefault).toBeUndefined()
    expect(contribution).toMatchObject({
      moduleType: DROPDOWN_MENU_MODULE_TYPE,
      adapterId: 'open-pencil.dropdown-menu',
      configVersion: DROPDOWN_MENU_MODULE_CONFIG_VERSION,
      defaultConfig: DROPDOWN_MENU_MODULE_DEFAULT_CONFIG
    })
    expect(contribution?.fields.find(({ path }) => path[0] === 'items')).toMatchObject({
      kind: 'json',
      label: 'Items'
    })
  })
})
