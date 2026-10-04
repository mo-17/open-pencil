import { expect, test } from 'bun:test'

import { SLIDE_MENU_MODULE_DEFINITION } from '@open-pencil/core/plugins'
import { parsePluginManifestPayload } from '@open-pencil/plugin-contracts'

import { createBundledPluginCatalog } from '@/app/plugins/catalog'
import { inspectPluginModuleCompatibility } from '@/app/plugins/modules'

test('optional drawer content stays available in the host without invalidating its portable manifest', () => {
  const entry = createBundledPluginCatalog().find(
    (candidate) => candidate.manifest.plugin.id === 'open-pencil.slide-menu'
  )
  if (!entry) throw new Error('Missing bundled drawer')
  const manifest = parsePluginManifestPayload(entry.manifest)
  const module = manifest.contributions.modules[0]
  expect(inspectPluginModuleCompatibility(manifest.plugin.id, module).ok).toBe(true)
  expect(Object.hasOwn(module.defaultConfig, 'contentChildName')).toBe(false)
  expect(module.fields.some((field) => field.path[0] === 'contentChildName')).toBe(false)
  expect(
    SLIDE_MENU_MODULE_DEFINITION.fields.some((field) => field.path[0] === 'contentChildName')
  ).toBe(true)
})
