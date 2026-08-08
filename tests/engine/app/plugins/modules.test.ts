import { describe, expect, test } from 'bun:test'

import {
  CAROUSEL_MODULE_TYPE,
  CAROUSEL_PLUGIN_ID,
  DATA_GRID_MODULE_TYPE,
  DATA_GRID_PLUGIN_ID,
  HTML_MODULE_TYPE,
  HTML_PLUGIN_ID,
  LOTTIE_MODULE_TYPE,
  LOTTIE_PLUGIN_ID,
  SLIDE_MENU_MODULE_TYPE,
  SLIDE_MENU_PLUGIN_ID,
  TABLE_MODULE_TYPE,
  TABLE_PLUGIN_ID,
  VIDEO_MODULE_TYPE,
  VIDEO_PLUGIN_ID,
  type DeclarativeModuleContributionV1
} from '@open-pencil/core/plugins'

import {
  createBundledPluginCatalog,
  inspectPluginModuleCompatibility,
  inspectPluginModuleContributionsCompatibility
} from '@/app/plugins'

function mapContribution(): DeclarativeModuleContributionV1 {
  const entry = createBundledPluginCatalog().find(
    (candidate) => candidate.manifest.plugin.id === 'open-pencil.map'
  )
  const contribution = entry?.manifest.contributions.modules[0]
  if (!contribution) throw new Error('Expected bundled Map contribution')
  return structuredClone(contribution)
}

function htmlContribution(): DeclarativeModuleContributionV1 {
  return contributionFor(HTML_PLUGIN_ID)
}

function contributionFor(pluginId: string): DeclarativeModuleContributionV1 {
  const entry = createBundledPluginCatalog().find(
    (candidate) => candidate.manifest.plugin.id === pluginId
  )
  const contribution = entry?.manifest.contributions.modules[0]
  if (!contribution) throw new Error(`Expected bundled contribution for ${pluginId}`)
  return structuredClone(contribution)
}

describe('app plugin module adapter compatibility', () => {
  test('accepts only the reviewed host adapter identity and config version', () => {
    const compatibility = inspectPluginModuleCompatibility('open-pencil.map', mapContribution())

    expect(compatibility.ok).toBe(true)
    expect(compatibility.status).toBe('compatible')
    if (compatibility.ok) {
      expect(compatibility.definition).toMatchObject({
        pluginId: 'open-pencil.map',
        moduleType: 'map',
        configVersion: 1
      })
    }
  })

  test('accepts the reviewed HTML host adapter without granting another plugin access', () => {
    const contribution = htmlContribution()
    const compatibility = inspectPluginModuleCompatibility(HTML_PLUGIN_ID, contribution)

    expect(compatibility).toMatchObject({
      ok: true,
      status: 'compatible',
      definition: {
        pluginId: HTML_PLUGIN_ID,
        moduleType: HTML_MODULE_TYPE,
        configVersion: 1
      }
    })
    expect(
      inspectPluginModuleCompatibility('publisher.untrusted-html', contribution)
    ).toMatchObject({ ok: false, status: 'plugin-identity-mismatch' })
  })

  test('accepts only reviewed non-default module host adapter identities', () => {
    const cases = [
      [VIDEO_PLUGIN_ID, VIDEO_MODULE_TYPE],
      [TABLE_PLUGIN_ID, TABLE_MODULE_TYPE],
      [SLIDE_MENU_PLUGIN_ID, SLIDE_MENU_MODULE_TYPE],
      [LOTTIE_PLUGIN_ID, LOTTIE_MODULE_TYPE],
      [CAROUSEL_PLUGIN_ID, CAROUSEL_MODULE_TYPE],
      [DATA_GRID_PLUGIN_ID, DATA_GRID_MODULE_TYPE]
    ] as const

    for (const [pluginId, moduleType] of cases) {
      const contribution = contributionFor(pluginId)
      expect(inspectPluginModuleCompatibility(pluginId, contribution)).toMatchObject({
        ok: true,
        status: 'compatible',
        definition: { pluginId, moduleType, configVersion: 1 }
      })
      expect(
        inspectPluginModuleCompatibility('publisher.untrusted-module', contribution)
      ).toMatchObject({ ok: false, status: 'plugin-identity-mismatch' })
    }
  })

  test('rejects unknown adapters and cross-plugin adapter reuse', () => {
    expect(
      inspectPluginModuleCompatibility('open-pencil.map', {
        ...mapContribution(),
        adapterId: 'publisher.unknown'
      })
    ).toMatchObject({ ok: false, status: 'untrusted-adapter' })

    expect(inspectPluginModuleCompatibility('publisher.other', mapContribution())).toMatchObject({
      ok: false,
      status: 'plugin-identity-mismatch'
    })
  })

  test('rejects module identity and config-version mismatches before creation', () => {
    expect(
      inspectPluginModuleCompatibility('open-pencil.map', {
        ...mapContribution(),
        moduleType: 'chart'
      })
    ).toMatchObject({ ok: false, status: 'module-identity-mismatch' })

    expect(
      inspectPluginModuleCompatibility('open-pencil.map', {
        ...mapContribution(),
        configVersion: 2
      })
    ).toMatchObject({ ok: false, status: 'config-version-mismatch' })
  })

  test('runs the host validator against the manifest default config', () => {
    expect(
      inspectPluginModuleCompatibility('open-pencil.map', {
        ...mapContribution(),
        defaultConfig: { ...mapContribution().defaultConfig, zoom: 99 }
      })
    ).toMatchObject({ ok: false, status: 'invalid-default-config' })
  })

  test('requires every pending manifest contribution to be host-compatible', () => {
    expect(
      inspectPluginModuleContributionsCompatibility('open-pencil.map', [mapContribution()])
    ).toEqual([])

    expect(
      inspectPluginModuleContributionsCompatibility('open-pencil.map', [
        mapContribution(),
        { ...mapContribution(), moduleType: 'future-map', configVersion: 2 }
      ])
    ).toEqual([
      expect.objectContaining({
        moduleType: 'future-map',
        status: 'module-identity-mismatch'
      })
    ])
  })
})
