import { describe, expect, test } from 'bun:test'

import {
  UPLOAD_BUTTON_MODULE_CONFIG_VERSION,
  UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG,
  UPLOAD_BUTTON_MODULE_TYPE,
  UPLOAD_BUTTON_PLUGIN_ID
} from '@open-pencil/core/plugins'

import { createBundledPluginCatalog } from '@/app/plugins/catalog'

describe('Upload Button bundled catalog entry', () => {
  test('publishes the exact reviewed adapter and stays opt-in by default', () => {
    const entry = createBundledPluginCatalog().find(
      (candidate) => candidate.manifest.plugin.id === UPLOAD_BUTTON_PLUGIN_ID
    )
    const contribution = entry?.manifest.contributions.modules[0]

    expect(entry?.installedByDefault).toBeUndefined()
    expect(entry?.enabledByDefault).toBeUndefined()
    expect(contribution).toMatchObject({
      moduleType: UPLOAD_BUTTON_MODULE_TYPE,
      adapterId: 'open-pencil.upload-button',
      configVersion: UPLOAD_BUTTON_MODULE_CONFIG_VERSION,
      defaultConfig: UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG
    })
    expect(contribution?.fields.find(({ path }) => path[0] === 'accept')).toMatchObject({
      kind: 'json',
      label: 'Accepted file types'
    })
  })
})
