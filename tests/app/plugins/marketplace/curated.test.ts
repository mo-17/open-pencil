import { afterEach, describe, expect, test } from 'bun:test'

import {
  parsePluginObjectParameterValue,
  parseTrustedPluginKeyring,
  parseVersionedPluginManifestPayload,
  signVersionedPluginManifest,
  type PluginManifestPayload
} from '@open-pencil/plugin-contracts'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createEditorStore, type EditorStore } from '@/app/editor/session'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  inspectPluginCommandCompatibility,
  inspectPluginExporterCompatibility,
  inspectPluginHostContributionsCompatibility,
  resolveTrustedPluginExporterExecutor,
  runInstalledPluginCommand,
  runInstalledPluginExporter,
  type AppPluginHostExecutors,
  type CreateAppPluginStoreOptions
} from '@/app/plugins'
import {
  createPluginExportResultData,
  PLUGIN_EXPORT_RESULT_CONTRACT
} from '@/app/plugins/host/export-result'
import {
  createMarketplacePluginManifests,
  MARKETPLACE_HOST_PLUGIN_ALIASES
} from '@/app/plugins/host/marketplace'

const NOW = Date.parse('2026-10-24T00:00:00.000Z')
const editors: EditorStore[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
})

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(label)
  return value
}

function editorFixture(): EditorStore {
  const editor = createEditorStore(new SceneGraph())
  editors.push(editor)
  const page = required(editor.graph.getPages()[0], 'Expected document page')
  editor.graph.createNode('RECTANGLE', page.id, {
    name: 'Small button',
    width: 12,
    height: 12
  })
  editor.graph.createNode('FRAME', page.id, {
    name: 'Off-grid spacing',
    paddingLeft: 7
  })
  editor.graph.updateNode(editor.graph.rootId, {
    lowcodeCustomCss: '.example { background: url(javascript:PRIVATE_MARKER); }'
  })
  return editor
}

function manifestFor(pluginId: string): PluginManifestPayload {
  return required(
    createMarketplacePluginManifests().find((manifest) => manifest.plugin.id === pluginId),
    `Expected curated manifest ${pluginId}`
  )
}

async function installedFixture() {
  const key = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const payloads = createMarketplacePluginManifests().map((manifest) => ({
    ...manifest,
    publisher: {
      id: 'curated.publisher',
      name: 'Curated Publisher',
      keyId: 'curated.publisher.2026'
    }
  }))
  const signed = await Promise.all(
    payloads.map((payload) => signVersionedPluginManifest(payload, key.privateKey))
  )
  const options: CreateAppPluginStoreOptions = {
    storage: createMemoryAppPluginStateStorage(),
    catalog: [
      ...createBundledPluginCatalog(),
      ...signed.map((manifest) => ({
        trustSource: 'publisher-signature' as const,
        manifest,
        trustedPublicKey: key.publicKey,
        expectedPluginId: manifest.plugin.id,
        expectedPublisherId: manifest.publisher.id,
        expectedKeyId: manifest.publisher.keyId
      }))
    ],
    trustedKeyring: parseTrustedPluginKeyring({
      schemaVersion: 1,
      keys: [
        {
          keyId: 'curated.publisher.2026',
          publisherId: 'curated.publisher',
          pluginIds: payloads.map((payload) => payload.plugin.id).sort(),
          publicKey: key.publicKey,
          notBefore: '2020-01-01T00:00:00.000Z',
          notAfter: '2030-01-01T00:00:00.000Z'
        }
      ]
    }),
    engineVersion: '0.16.0',
    now: () => NOW,
    activationCompatibilityPolicy(manifest) {
      const issue = inspectPluginHostContributionsCompatibility(
        manifest.plugin.id,
        manifest.contributions
      )[0]
      return issue ? { ok: false, reason: issue.reason } : { ok: true }
    }
  }
  const store = createAppPluginStore(options)
  await store.load()
  for (const payload of payloads) {
    const candidate = required(
      store
        .snapshot()
        .catalog.find((item) => item.package.manifest.plugin.id === payload.plugin.id),
      'Expected verified marketplace catalog entry'
    )
    const installed = await store.installReviewed(payload.plugin.id, candidate.package)
    expect(installed.enabled).toBe(false)
    await store.setEnabled(payload.plugin.id, true)
  }
  return { store, options }
}

describe('curated marketplace plugin identities', () => {
  test('keeps worst-case Unicode and escaped warning output inside the signed result contract', () => {
    const data = createPluginExportResultData({
      fileName: '\u0000'.repeat(512),
      fileCount: 1,
      saved: true,
      warnings: Array.from({ length: 100 }, () => ({
        code: '\u0000'.repeat(256),
        message: '警'.repeat(2_048),
        nodeId: '\u0000'.repeat(256)
      }))
    })
    expect<unknown>(
      parsePluginObjectParameterValue(
        data,
        PLUGIN_EXPORT_RESULT_CONTRACT.schema,
        PLUGIN_EXPORT_RESULT_CONTRACT.maxBytes,
        'Curated exporter result'
      )
    ).toEqual(data)
    expect(new TextEncoder().encode(JSON.stringify(data)).byteLength).toBeLessThanOrEqual(
      PLUGIN_EXPORT_RESULT_CONTRACT.maxBytes
    )
    expect(data.warningCount).toBe(100)
    expect(data.warningsTruncated).toBe(true)
    if (!Array.isArray(data.warnings)) throw new Error('Expected bounded warning array')
    expect(data.warnings.length).toBeLessThan(100)
  })

  test('derives eight independently installable manifests without changing bundled contracts', () => {
    const before = createBundledPluginCatalog()
    const manifests = createMarketplacePluginManifests()
    expect(manifests).toHaveLength(8)
    expect(new Set(manifests.map((manifest) => manifest.plugin.id)).size).toBe(8)
    for (const alias of MARKETPLACE_HOST_PLUGIN_ALIASES) {
      const original = required(
        before.find((entry) => entry.manifest.plugin.id === alias.originalPluginId),
        'Expected bundled source'
      )
      const manifest = required(
        manifests.find((entry) => entry.plugin.id === alias.newPluginId),
        'Expected market identity'
      )
      expect(before.some((entry) => entry.manifest.plugin.id === manifest.plugin.id)).toBe(false)
      expect(parseVersionedPluginManifestPayload(manifest)).toEqual(manifest)
      expect(
        inspectPluginHostContributionsCompatibility(manifest.plugin.id, manifest.contributions)
      ).toEqual([])
      const restored = structuredClone(manifest)
      restored.plugin.id = alias.originalPluginId
      const contribution =
        alias.kind === 'command'
          ? restored.contributions.commands?.[0]
          : restored.contributions.exporters?.[0]
      required(contribution, 'Expected contribution').adapterId = alias.originalAdapterId
      expect(restored).toEqual(original.manifest)
    }
    expect(createBundledPluginCatalog()).toEqual(before)
  })

  for (const alias of MARKETPLACE_HOST_PLUGIN_ALIASES) {
    test(`${alias.newPluginId} rejects changed identity and contribution authority`, () => {
      const manifest = manifestFor(alias.newPluginId)
      if (alias.kind === 'command') {
        if (manifest.schemaVersion !== 2) throw new Error('Expected v2 audit')
        const command = required(manifest.contributions.commands?.[0], 'Expected audit command')
        expect(inspectPluginCommandCompatibility(alias.originalPluginId, command).ok).toBe(false)
        expect(
          inspectPluginCommandCompatibility(alias.newPluginId, {
            ...command,
            adapterId: alias.originalAdapterId
          }).ok
        ).toBe(false)
        expect(
          inspectPluginCommandCompatibility(alias.newPluginId, {
            ...command,
            commandId: 'other-command'
          }).ok
        ).toBe(false)
        expect(
          inspectPluginCommandCompatibility(alias.newPluginId, { ...command, permissions: [] }).ok
        ).toBe(false)
        expect(
          inspectPluginCommandCompatibility(alias.newPluginId, {
            ...command,
            parameters: { ...command.parameters, maxBytes: command.parameters.maxBytes + 1 }
          }).ok
        ).toBe(false)
        expect(
          inspectPluginCommandCompatibility(alias.newPluginId, {
            ...command,
            result: { ...command.result, maxBytes: command.result.maxBytes + 1 }
          }).ok
        ).toBe(false)
        const {
          parameters: _parameters,
          result: _result,
          permissions: _permissions,
          ...v1
        } = command
        expect(inspectPluginCommandCompatibility(alias.newPluginId, v1).ok).toBe(false)
      } else {
        const exporter = required(manifest.contributions.exporters?.[0], 'Expected exporter')
        expect(inspectPluginExporterCompatibility(alias.originalPluginId, exporter).ok).toBe(false)
        expect(
          inspectPluginExporterCompatibility(alias.newPluginId, {
            ...exporter,
            adapterId: alias.originalAdapterId
          }).ok
        ).toBe(false)
        expect(
          inspectPluginExporterCompatibility(alias.newPluginId, {
            ...exporter,
            exporterId: 'other-exporter'
          }).ok
        ).toBe(false)
        if (manifest.schemaVersion === 2) {
          const v2 = required(manifest.contributions.exporters?.[0], 'Expected v2 exporter')
          expect(
            inspectPluginExporterCompatibility(alias.newPluginId, { ...v2, permissions: [] }).ok
          ).toBe(false)
          expect(
            inspectPluginExporterCompatibility(alias.newPluginId, {
              ...v2,
              outputs: [{ extension: 'unsafe', mimeType: 'application/octet-stream' }]
            }).ok
          ).toBe(false)
          expect(
            inspectPluginExporterCompatibility(alias.newPluginId, {
              ...v2,
              parameters: { ...v2.parameters, maxBytes: v2.parameters.maxBytes + 1 }
            }).ok
          ).toBe(false)
          expect(
            inspectPluginExporterCompatibility(alias.newPluginId, {
              ...v2,
              result: { ...v2.result, maxBytes: v2.result.maxBytes + 1 }
            }).ok
          ).toBe(false)
          const {
            parameters: _parameters,
            result: _result,
            permissions: _permissions,
            outputs: _outputs,
            ...v1
          } = v2
          expect(
            inspectPluginExporterCompatibility(alias.newPluginId, { ...v1, fileExtension: 'zip' })
              .ok
          ).toBe(false)
        } else {
          const v1 = required(manifest.contributions.exporters?.[0], 'Expected v1 exporter')
          expect(
            inspectPluginExporterCompatibility(alias.newPluginId, {
              ...v1,
              fileExtension: 'unsafe'
            }).ok
          ).toBe(false)
          expect(
            inspectPluginExporterCompatibility(alias.newPluginId, {
              ...v1,
              permissions: ['document.read']
            }).ok
          ).toBe(false)
        }
      }
    })
  }

  test('verifies signatures, installs alongside bundled plugins, and executes real audit findings after reload', async () => {
    const { store, options } = await installedFixture()
    const reloaded = createAppPluginStore(options)
    await reloaded.load()
    const editor = editorFixture()
    const graphBefore = structuredClone([...editor.graph.getAllNodes()])
    const expected = [
      ['marketplace.accessibility-audit', 'touch-target-size'],
      ['marketplace.design-system-audit', 'off-base-spacing-value'],
      ['marketplace.application-security-readiness', 'unsafe-custom-css-url']
    ] as const
    for (const [pluginId, finding] of expected) {
      const plugin = required(
        reloaded
          .snapshot()
          .installed.find((entry) => entry.package.manifest.plugin.id === pluginId),
        'Expected restored signed installation'
      )
      expect(plugin.enabled).toBe(true)
      expect(plugin.blockedReason).toBeUndefined()
      expect(plugin.package.trustSource).toBe('publisher-signature')
      const command = required(
        plugin.package.manifest.contributions.commands?.[0],
        'Expected installed command'
      )
      const result = await runInstalledPluginCommand(editor, plugin, command)
      expect(result.status).toBe('completed')
      expect(JSON.stringify(result.data)).toContain(finding)
      expect(JSON.stringify(result.data)).not.toContain('PRIVATE_MARKER')
      await expect(
        runInstalledPluginCommand(editor, { ...plugin, enabled: false }, command)
      ).rejects.toThrow()
    }
    expect([...editor.graph.getAllNodes()]).toEqual(graphBefore)
    for (const alias of MARKETPLACE_HOST_PLUGIN_ALIASES) {
      expect(
        store
          .snapshot()
          .catalog.some(
            (entry) =>
              entry.package.manifest.plugin.id === alias.originalPluginId &&
              entry.package.trustSource === 'app-bundle'
          )
      ).toBe(true)
      expect(
        reloaded
          .snapshot()
          .installed.some((entry) => entry.package.manifest.plugin.id === alias.newPluginId)
      ).toBe(true)
    }
  })

  test('dispatches signed exporters through their reviewed alias and preserves original executors without saving', async () => {
    const { store } = await installedFixture()
    const editor = editorFixture()
    for (const alias of MARKETPLACE_HOST_PLUGIN_ALIASES.filter(
      (entry) => entry.kind === 'exporter'
    )) {
      const plugin = required(
        store
          .snapshot()
          .installed.find((entry) => entry.package.manifest.plugin.id === alias.newPluginId),
        'Expected signed exporter installation'
      )
      const exporter = required(
        plugin.package.manifest.contributions.exporters?.[0],
        'Expected installed exporter'
      )
      expect(resolveTrustedPluginExporterExecutor(alias.newAdapterId)).toBe(
        resolveTrustedPluginExporterExecutor(alias.originalAdapterId)
      )
      expect(resolveTrustedPluginExporterExecutor(alias.newAdapterId)).toBeFunction()
      const calls: string[] = []
      let saved = false
      const executors: AppPluginHostExecutors = {
        clipboard: async () => {
          throw new Error('Clipboard is outside exporter scope')
        },
        resolveExporter(adapterId) {
          calls.push(adapterId)
          return async () => ({
            fileName: 'curated.zip',
            fileCount: 1,
            warnings: [{ code: 'fixture-warning', message: 'Reviewed warning', nodeId: 'node:1' }],
            saved
          })
        }
      }
      const result = await runInstalledPluginExporter(editor, plugin, exporter, executors)
      expect(calls).toEqual([alias.newAdapterId])
      expect(result.status).toBe('cancelled')
      expect(result.data).toMatchObject({
        kind: 'plugin-export',
        fileName: 'curated.zip',
        fileCount: 1,
        warningCount: 1,
        warnings: [{ code: 'fixture-warning', message: 'Reviewed warning', nodeId: 'node:1' }],
        warningsTruncated: false
      })
      saved = true
      await expect(
        runInstalledPluginExporter(editor, plugin, exporter, executors)
      ).resolves.toMatchObject({ status: 'completed', data: result.data })
    }
  })
})
