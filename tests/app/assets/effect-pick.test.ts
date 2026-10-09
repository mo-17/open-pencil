import { describe, expect, test } from 'bun:test'

import {
  EFFECT_PICK_CATALOG,
  EFFECT_PICK_MODULE,
  EFFECT_PICK_PLUGIN_ID,
  resolveEffectPickModule
} from '@open-pencil/core/plugins'

import { effectPickAssetModule, moduleAssetVariants, pluginAssetKey } from '@/app/assets/catalog'
import {
  inspectInstalledPluginModuleCompatibility,
  type InstalledPluginModule
} from '@/app/plugins'

function bundledModule(): InstalledPluginModule {
  const contribution = {
    moduleType: EFFECT_PICK_MODULE.moduleType,
    name: EFFECT_PICK_MODULE.name,
    description: EFFECT_PICK_MODULE.description,
    adapterId: EFFECT_PICK_PLUGIN_ID,
    configVersion: EFFECT_PICK_MODULE.configVersion,
    defaultSize: { ...EFFECT_PICK_MODULE.defaultSize },
    defaultConfig: structuredClone(EFFECT_PICK_MODULE.defaultConfig),
    fields: []
  }
  return {
    contribution,
    plugin: {
      package: {
        trustSource: 'app-bundle',
        digest: 'reviewed-local-effect-pick',
        manifest: {
          format: 'openpencil-plugin',
          schemaVersion: 1,
          plugin: { id: EFFECT_PICK_PLUGIN_ID, name: 'EffectPick', version: '0.6.0' },
          publisher: { id: 'open-pencil', name: 'OpenPencil', keyId: 'app-bundle-v1' },
          engineRange: '*',
          capabilities: [],
          contributions: { modules: [contribution] }
        }
      },
      enabled: true,
      pinnedDigest: null
    }
  }
}

describe('reviewed EffectPick assets', () => {
  test('discovers each curated artifact and keeps effect favorites independent', () => {
    const module = bundledModule()
    const assets = moduleAssetVariants(module)
    expect(assets.length).toBeGreaterThanOrEqual(10)
    expect(assets.map((asset) => asset.effectId)).toEqual(
      EFFECT_PICK_CATALOG.map((entry) => entry.id)
    )
    const keys = assets.map((asset) => pluginAssetKey(asset.module, asset.effectId))
    expect(new Set(keys).size).toBe(assets.length)
    expect(keys).not.toContain(pluginAssetKey(module))
  })

  test('selects the exact defaults, size, version and digest through one trusted module', () => {
    const module = bundledModule()
    const original = structuredClone(module.contribution.defaultConfig)
    for (const effect of EFFECT_PICK_CATALOG) {
      const asset = effectPickAssetModule(module, effect.id)
      expect(asset.plugin).toBe(module.plugin)
      expect(asset.contribution.moduleType).toBe(module.contribution.moduleType)
      expect(asset.contribution.defaultSize).toEqual(effect.defaultSize)
      expect(inspectInstalledPluginModuleCompatibility(asset).ok).toBe(true)
      const instance = EFFECT_PICK_MODULE.createInstance(asset.contribution.defaultConfig)
      const resolved = resolveEffectPickModule(instance)
      expect(resolved?.ok).toBe(true)
      if (!resolved?.ok) throw new Error('Expected a resolved reviewed effect')
      expect(resolved.config).toEqual(effect.defaultConfig)
      asset.contribution.defaultConfig.text = 'Independent asset configuration'
      expect(effect.defaultConfig.text).not.toBe(asset.contribution.defaultConfig.text)
    }
    expect(module.contribution.defaultConfig).toEqual(original)
  })

  test('rejects unknown artifacts and publisher attempts to claim bundled effect identity', () => {
    const module = bundledModule()
    expect(() => effectPickAssetModule(module, 'unreviewed-script')).toThrow()
    const publisher: InstalledPluginModule = {
      ...module,
      plugin: {
        ...module.plugin,
        package: { ...module.plugin.package, trustSource: 'publisher-signature' }
      }
    }
    expect(moduleAssetVariants(publisher)).toEqual([{ module: publisher }])
    expect(() => effectPickAssetModule(publisher, 'diagonal-fill')).toThrow()
    const other: InstalledPluginModule = {
      ...module,
      contribution: { ...module.contribution, moduleType: 'html' }
    }
    expect(moduleAssetVariants(other)).toEqual([{ module: other }])
    expect(() => effectPickAssetModule(other, 'diagonal-fill')).toThrow()
  })
})
