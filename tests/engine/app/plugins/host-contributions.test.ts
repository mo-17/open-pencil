import { describe, expect, test } from 'bun:test'

import type {
  DeclarativeCommandContributionV1,
  DeclarativeCommandContributionV2,
  DeclarativeExporterContributionV1,
  DeclarativeExporterContributionV2,
  PluginManifestPayload,
  PluginManifestPayloadV1,
  PluginManifestPayloadV2,
  PluginStorageProviderContributionV2
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'
import {
  GOOGLE_DRIVE_STORAGE_ADAPTER_ID,
  GOOGLE_DRIVE_STORAGE_PLUGIN_ID,
  GOOGLE_DRIVE_STORAGE_PROVIDER_ID
} from '@/app/integrations/storage/google-drive/config'
import {
  createBundledPluginCatalog,
  inspectPluginCommandCompatibility,
  inspectPluginExporterCompatibility,
  inspectPluginExporterMCPExposure,
  inspectPluginHostContributionsCompatibility,
  inspectPluginStorageProviderCompatibility,
  resolveTrustedPluginExporterExecutor,
  runInstalledPluginCommand,
  runInstalledPluginExporter,
  supportsPluginExporterCancellation,
  type AppPluginHostExecutors,
  type InstalledAppPlugin
} from '@/app/plugins'
import { inspectPluginCommandMCPExposure } from '@/app/plugins/host'
import { exportCurrentDocumentAsExpoReactNativeSource } from '@/app/plugins/host/expo-react-native-exporter'
import { exportCurrentDocumentAsFlutterSource } from '@/app/plugins/host/flutter-exporter'
import {
  AI_POPOUT_COMMAND,
  AI_POPOUT_PLUGIN_ID,
  CAPACITOR_EXPORTER,
  CAPACITOR_EXPORTER_PLUGIN_ID,
  CLIPBOARD_COMMANDS,
  CLIPBOARD_TOOLKIT_PLUGIN_ID,
  COMPILER_PREVIEW_POPOUT_COMMAND,
  COMPILER_PREVIEW_POPOUT_PLUGIN_ID,
  ACCESSIBILITY_AUDIT_PLUGIN_ID,
  DESIGN_TOKENS_EXPORTER,
  DESIGN_TOKENS_EXPORTER_PLUGIN_ID,
  DESIGN_SYSTEM_AUDIT_COMMAND,
  DESIGN_SYSTEM_AUDIT_PLUGIN_ID,
  ELECTRON_EXPORTER,
  ELECTRON_EXPORTER_PLUGIN_ID,
  EXPO_REACT_NATIVE_EXPORTER,
  EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
  FLUTTER_EXPORTER,
  FLUTTER_EXPORTER_PLUGIN_ID,
  GOOGLE_DRIVE_STORAGE_CAPABILITIES,
  GOOGLE_DRIVE_STORAGE_CONFIG_VERSION,
  NEXTJS_EXPORTER,
  NEXTJS_EXPORTER_PLUGIN_ID,
  TAURI_REACT_EXPORTER,
  TAURI_REACT_EXPORTER_PLUGIN_ID,
  VUE_EXPORTER,
  VUE_EXPORTER_PLUGIN_ID
} from '@/app/plugins/host/ids'
import { exportCurrentDocumentAsTauriReactSource } from '@/app/plugins/host/tauri-react-exporter'

const EDITOR = {} as EditorStore

function bundledManifest(pluginId: string): PluginManifestPayloadV1 {
  const manifest = createBundledPluginCatalog().find(
    (entry) => entry.manifest.plugin.id === pluginId
  )?.manifest
  if (!manifest) throw new Error(`Missing bundled plugin: ${pluginId}`)
  return structuredClone(manifest)
}

function bundledManifestV2(pluginId: string): PluginManifestPayloadV2 {
  const manifest = createBundledPluginCatalog().find(
    (entry) => entry.manifest.plugin.id === pluginId
  )?.manifest
  if (manifest?.schemaVersion !== 2) {
    throw new Error(`Missing bundled v2 plugin: ${pluginId}`)
  }
  return structuredClone(manifest)
}

function accessibilityContribution(): DeclarativeCommandContributionV2 {
  const contribution = bundledManifestV2(ACCESSIBILITY_AUDIT_PLUGIN_ID).contributions.commands?.[0]
  if (!contribution) throw new Error('Missing bundled accessibility command')
  return contribution
}

function designSystemContribution(): DeclarativeCommandContributionV2 {
  const contribution = bundledManifestV2(DESIGN_SYSTEM_AUDIT_PLUGIN_ID).contributions.commands?.[0]
  if (!contribution) throw new Error('Missing bundled design-system command')
  return contribution
}

function compilerPreviewPopoutContribution(): DeclarativeCommandContributionV2 {
  const contribution = bundledManifestV2(COMPILER_PREVIEW_POPOUT_PLUGIN_ID).contributions
    .commands?.[0]
  if (!contribution) throw new Error('Missing bundled compiler preview popout command')
  return contribution
}

function aiPopoutContribution(): DeclarativeCommandContributionV2 {
  const contribution = bundledManifestV2(AI_POPOUT_PLUGIN_ID).contributions.commands?.[0]
  if (!contribution) throw new Error('Missing bundled AI popout command')
  return contribution
}

function designTokensContribution(): DeclarativeExporterContributionV2 {
  const contribution = bundledManifestV2(DESIGN_TOKENS_EXPORTER_PLUGIN_ID).contributions
    .exporters?.[0]
  if (!contribution) throw new Error('Missing bundled design tokens exporter')
  return contribution
}

function googleDriveStorageContribution(): PluginStorageProviderContributionV2 {
  const contribution = bundledManifestV2(GOOGLE_DRIVE_STORAGE_PLUGIN_ID).contributions
    .storageProviders?.[0]
  if (!contribution) throw new Error('Missing bundled Google Drive storage provider')
  return contribution
}

function commandContribution(): DeclarativeCommandContributionV1 {
  const contribution = bundledManifest(CLIPBOARD_TOOLKIT_PLUGIN_ID).contributions.commands?.find(
    (candidate) => candidate.commandId === CLIPBOARD_COMMANDS.text.commandId
  )
  if (!contribution) throw new Error('Missing bundled clipboard command')
  return contribution
}

function exporterContribution(): DeclarativeExporterContributionV1 {
  const contribution = bundledManifest(
    TAURI_REACT_EXPORTER_PLUGIN_ID
  ).contributions.exporters?.find(
    (candidate) => candidate.exporterId === TAURI_REACT_EXPORTER.exporterId
  )
  if (!contribution) throw new Error('Missing bundled Tauri exporter')
  return contribution
}

function expoExporterContribution(): DeclarativeExporterContributionV1 {
  const contribution = bundledManifest(
    EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID
  ).contributions.exporters?.find(
    (candidate) => candidate.exporterId === EXPO_REACT_NATIVE_EXPORTER.exporterId
  )
  if (!contribution) throw new Error('Missing bundled Expo exporter')
  return contribution
}

function flutterExporterContribution(): DeclarativeExporterContributionV1 {
  const contribution = bundledManifest(FLUTTER_EXPORTER_PLUGIN_ID).contributions.exporters?.find(
    (candidate) => candidate.exporterId === FLUTTER_EXPORTER.exporterId
  )
  if (!contribution) throw new Error('Missing bundled Flutter exporter')
  return contribution
}

function bundledV1ExporterContribution(
  pluginId: string,
  exporterId: string
): DeclarativeExporterContributionV1 {
  const contribution = bundledManifest(pluginId).contributions.exporters?.find(
    (candidate) => candidate.exporterId === exporterId
  )
  if (!contribution) throw new Error(`Missing bundled exporter: ${pluginId}/${exporterId}`)
  return contribution
}

function installedPlugin(
  manifest: PluginManifestPayload,
  enabled: boolean,
  blockedReason?: string
): InstalledAppPlugin {
  return {
    package: { trustSource: 'app-bundle', manifest, digest: 'test-digest' },
    enabled,
    pinnedDigest: null,
    ...(blockedReason ? { blockedReason } : {})
  }
}

function executors(
  onCall: (kind: 'clipboard' | 'exporter-resolve' | 'exporter', id?: string) => void
) {
  return {
    async clipboard(_editor, commandId) {
      onCall('clipboard', commandId)
      return `ran ${commandId}`
    },
    resolveExporter(adapterId) {
      onCall('exporter-resolve', adapterId)
      return async () => {
        onCall('exporter', adapterId)
        return { fileName: 'demo.zip', fileCount: 9, warnings: [], saved: true }
      }
    }
  } satisfies AppPluginHostExecutors
}

function completedExportResult() {
  return {
    status: 'completed' as const,
    message: 'Exported 9 files to demo.zip',
    data: {
      kind: 'plugin-export',
      fileName: 'demo.zip',
      fileCount: 9,
      warningCount: 0,
      warnings: [],
      warningsTruncated: false
    }
  }
}

describe('app plugin host contribution trust', () => {
  test('registers each bundled exporter adapter with its exact host executor', () => {
    expect(resolveTrustedPluginExporterExecutor(TAURI_REACT_EXPORTER.adapterId)).toBe(
      exportCurrentDocumentAsTauriReactSource
    )
    expect(resolveTrustedPluginExporterExecutor(EXPO_REACT_NATIVE_EXPORTER.adapterId)).toBe(
      exportCurrentDocumentAsExpoReactNativeSource
    )
    expect(resolveTrustedPluginExporterExecutor(FLUTTER_EXPORTER.adapterId)).toBe(
      exportCurrentDocumentAsFlutterSource
    )
    expect(resolveTrustedPluginExporterExecutor(NEXTJS_EXPORTER.adapterId)).toBeFunction()
    expect(resolveTrustedPluginExporterExecutor(CAPACITOR_EXPORTER.adapterId)).toBeFunction()
    expect(resolveTrustedPluginExporterExecutor(ELECTRON_EXPORTER.adapterId)).toBeFunction()
    expect(resolveTrustedPluginExporterExecutor(VUE_EXPORTER.adapterId)).toBeFunction()
    expect(resolveTrustedPluginExporterExecutor('publisher.unreviewed-exporter')).toBeUndefined()
  })

  test('binds command adapters to the exact plugin and contribution identities', () => {
    const contribution = commandContribution()

    expect(inspectPluginCommandCompatibility(CLIPBOARD_TOOLKIT_PLUGIN_ID, contribution)).toEqual({
      ok: true,
      status: 'compatible'
    })
    expect(inspectPluginCommandCompatibility('publisher.other', contribution)).toMatchObject({
      ok: false,
      status: 'plugin-identity-mismatch'
    })
    expect(
      inspectPluginCommandCompatibility(CLIPBOARD_TOOLKIT_PLUGIN_ID, {
        ...contribution,
        commandId: 'copy-something-else'
      })
    ).toMatchObject({ ok: false, status: 'contribution-identity-mismatch' })
    expect(
      inspectPluginCommandCompatibility(CLIPBOARD_TOOLKIT_PLUGIN_ID, {
        ...contribution,
        adapterId: 'publisher.unreviewed-command'
      })
    ).toMatchObject({ ok: false, status: 'untrusted-adapter' })

    expect(
      inspectPluginCommandCompatibility(DESIGN_SYSTEM_AUDIT_PLUGIN_ID, designSystemContribution())
    ).toEqual({ ok: true, status: 'compatible' })
    expect(
      inspectPluginCommandCompatibility(ACCESSIBILITY_AUDIT_PLUGIN_ID, designSystemContribution())
    ).toMatchObject({ ok: false, status: 'plugin-identity-mismatch' })
  })

  test('keeps compiler preview popout host-owned, zero-argument, and unavailable to MCP', async () => {
    const manifest = bundledManifestV2(COMPILER_PREVIEW_POPOUT_PLUGIN_ID)
    const contribution = compilerPreviewPopoutContribution()
    const calls: unknown[] = []
    const host: AppPluginHostExecutors = {
      async clipboard() {
        throw new Error('Clipboard fallback must not run for a v2 command')
      },
      resolveCommand(adapterId) {
        expect(adapterId).toBe(COMPILER_PREVIEW_POPOUT_COMMAND.adapterId)
        return (_editor, args) => {
          calls.push(structuredClone(args))
          return {
            status: 'completed',
            message: 'Opened the active compiler preview in a separate window.'
          }
        }
      },
      resolveExporter() {
        return undefined
      }
    }

    expect(
      inspectPluginCommandCompatibility(COMPILER_PREVIEW_POPOUT_PLUGIN_ID, contribution)
    ).toEqual({ ok: true, status: 'compatible' })
    expect(inspectPluginCommandCompatibility('publisher.other', contribution)).toMatchObject({
      ok: false,
      status: 'plugin-identity-mismatch'
    })
    expect(
      inspectPluginCommandCompatibility(COMPILER_PREVIEW_POPOUT_PLUGIN_ID, {
        ...contribution,
        permissions: ['document.read']
      })
    ).toMatchObject({ ok: false, status: 'permissions-mismatch' })
    expect(
      inspectPluginCommandMCPExposure(COMPILER_PREVIEW_POPOUT_PLUGIN_ID, contribution)
    ).toMatchObject({ ok: false, status: 'mcp-exposure-disabled' })

    await expect(
      runInstalledPluginCommand(EDITOR, installedPlugin(manifest, true), contribution, host)
    ).resolves.toMatchObject({ status: 'completed' })
    expect(calls).toEqual([{}])

    await expect(
      runInstalledPluginCommand(EDITOR, installedPlugin(manifest, true), contribution, host, {
        url: 'https://attacker.example',
        label: 'forged',
        windowOptions: {}
      })
    ).rejects.toThrow('2-byte contract limit')
    expect(calls).toEqual([{}])
  })

  test('keeps AI popout host-owned, zero-argument, and unavailable to MCP', async () => {
    const manifest = bundledManifestV2(AI_POPOUT_PLUGIN_ID)
    const contribution = aiPopoutContribution()
    const calls: unknown[] = []
    const host: AppPluginHostExecutors = {
      async clipboard() {
        throw new Error('Clipboard fallback must not run for a v2 command')
      },
      resolveCommand(adapterId) {
        expect(adapterId).toBe(AI_POPOUT_COMMAND.adapterId)
        return (_editor, args) => {
          calls.push(structuredClone(args))
          return {
            status: 'completed',
            message: 'Opened the active AI chat in a separate window.'
          }
        }
      },
      resolveExporter() {
        return undefined
      }
    }

    expect(inspectPluginCommandCompatibility(AI_POPOUT_PLUGIN_ID, contribution)).toEqual({
      ok: true,
      status: 'compatible'
    })
    expect(inspectPluginCommandCompatibility('publisher.other', contribution)).toMatchObject({
      ok: false,
      status: 'plugin-identity-mismatch'
    })
    expect(
      inspectPluginCommandCompatibility(AI_POPOUT_PLUGIN_ID, {
        ...contribution,
        permissions: ['document.read']
      })
    ).toMatchObject({ ok: false, status: 'permissions-mismatch' })
    expect(inspectPluginCommandMCPExposure(AI_POPOUT_PLUGIN_ID, contribution)).toMatchObject({
      ok: false,
      status: 'mcp-exposure-disabled'
    })

    await expect(
      runInstalledPluginCommand(EDITOR, installedPlugin(manifest, true), contribution, host)
    ).resolves.toMatchObject({ status: 'completed' })
    expect(calls).toEqual([{}])

    await expect(
      runInstalledPluginCommand(EDITOR, installedPlugin(manifest, true), contribution, host, {
        prompt: 'forged',
        transcript: []
      })
    ).rejects.toThrow('2-byte contract limit')
    expect(calls).toEqual([{}])
  })

  test('binds storage providers to the exact host-owned adapter contract', () => {
    const contribution = googleDriveStorageContribution()

    expect(
      inspectPluginStorageProviderCompatibility(GOOGLE_DRIVE_STORAGE_PLUGIN_ID, contribution)
    ).toEqual({ ok: true, status: 'compatible' })
    expect(
      inspectPluginStorageProviderCompatibility('publisher.other', contribution)
    ).toMatchObject({ ok: false, status: 'plugin-identity-mismatch' })
    expect(
      inspectPluginStorageProviderCompatibility(GOOGLE_DRIVE_STORAGE_PLUGIN_ID, {
        ...contribution,
        providerId: 'different-provider'
      })
    ).toMatchObject({ ok: false, status: 'contribution-identity-mismatch' })
    expect(
      inspectPluginStorageProviderCompatibility(GOOGLE_DRIVE_STORAGE_PLUGIN_ID, {
        ...contribution,
        adapterId: 'publisher.unreviewed-storage'
      })
    ).toMatchObject({ ok: false, status: 'untrusted-adapter' })
    expect(
      inspectPluginStorageProviderCompatibility(GOOGLE_DRIVE_STORAGE_PLUGIN_ID, {
        ...contribution,
        configVersion: GOOGLE_DRIVE_STORAGE_CONFIG_VERSION + 1
      })
    ).toMatchObject({ ok: false, status: 'config-version-mismatch' })
    expect(
      inspectPluginStorageProviderCompatibility(GOOGLE_DRIVE_STORAGE_PLUGIN_ID, {
        ...contribution,
        capabilities: GOOGLE_DRIVE_STORAGE_CAPABILITIES.slice(0, -1)
      })
    ).toMatchObject({ ok: false, status: 'capabilities-mismatch' })

    expect(
      inspectPluginHostContributionsCompatibility(GOOGLE_DRIVE_STORAGE_PLUGIN_ID, {
        storageProviders: [
          {
            ...contribution,
            adapterId: GOOGLE_DRIVE_STORAGE_ADAPTER_ID,
            providerId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
            capabilities: GOOGLE_DRIVE_STORAGE_CAPABILITIES.slice(1)
          }
        ]
      })
    ).toEqual([
      expect.objectContaining({
        kind: 'storage-provider',
        contributionId: GOOGLE_DRIVE_STORAGE_PROVIDER_ID,
        status: 'capabilities-mismatch'
      })
    ])
  })

  test('runs and cooperatively cancels the reviewed design-system audit executor', async () => {
    const manifest = bundledManifestV2(DESIGN_SYSTEM_AUDIT_PLUGIN_ID)
    const contribution = designSystemContribution()
    const editor = { graph: new SceneGraph() } as EditorStore

    await expect(
      runInstalledPluginCommand(editor, installedPlugin(manifest, true), contribution)
    ).resolves.toMatchObject({
      status: 'completed',
      data: {
        kind: 'static-design-system-audit',
        pluginId: DESIGN_SYSTEM_AUDIT_PLUGIN_ID,
        commandId: DESIGN_SYSTEM_AUDIT_COMMAND.commandId
      }
    })

    const controller = new AbortController()
    controller.abort()
    await expect(
      runInstalledPluginCommand(
        editor,
        installedPlugin(manifest, true),
        contribution,
        undefined,
        {},
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('binds exporter adapters to the exact plugin, contribution, and file extension', () => {
    const contribution = exporterContribution()
    const expoContribution = expoExporterContribution()
    const flutterContribution = flutterExporterContribution()

    expect(
      inspectPluginExporterCompatibility(TAURI_REACT_EXPORTER_PLUGIN_ID, contribution)
    ).toEqual({ ok: true, status: 'compatible' })
    expect(inspectPluginExporterCompatibility('publisher.other', contribution)).toMatchObject({
      ok: false,
      status: 'plugin-identity-mismatch'
    })
    expect(
      inspectPluginExporterCompatibility(TAURI_REACT_EXPORTER_PLUGIN_ID, {
        ...contribution,
        exporterId: 'different-exporter'
      })
    ).toMatchObject({ ok: false, status: 'contribution-identity-mismatch' })
    expect(
      inspectPluginExporterCompatibility(TAURI_REACT_EXPORTER_PLUGIN_ID, {
        ...contribution,
        adapterId: 'publisher.unreviewed-exporter'
      })
    ).toMatchObject({ ok: false, status: 'untrusted-adapter' })
    expect(
      inspectPluginExporterCompatibility(TAURI_REACT_EXPORTER_PLUGIN_ID, {
        ...contribution,
        fileExtension: '.tar'
      })
    ).toMatchObject({ ok: false, status: 'file-extension-mismatch' })
    expect(
      inspectPluginExporterCompatibility(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID, expoContribution)
    ).toEqual({ ok: true, status: 'compatible' })
    expect(
      inspectPluginExporterCompatibility(TAURI_REACT_EXPORTER_PLUGIN_ID, expoContribution)
    ).toMatchObject({ ok: false, status: 'plugin-identity-mismatch' })
    expect(
      inspectPluginExporterCompatibility(FLUTTER_EXPORTER_PLUGIN_ID, flutterContribution)
    ).toEqual({ ok: true, status: 'compatible' })
    expect(
      inspectPluginExporterCompatibility(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID, flutterContribution)
    ).toMatchObject({ ok: false, status: 'plugin-identity-mismatch' })
    expect(
      inspectPluginExporterCompatibility(
        VUE_EXPORTER_PLUGIN_ID,
        bundledV1ExporterContribution(VUE_EXPORTER_PLUGIN_ID, VUE_EXPORTER.exporterId)
      )
    ).toEqual({ ok: true, status: 'compatible' })
  })

  test('keeps synchronous project exporters out of MCP until cancellation is cooperative', () => {
    for (const [pluginId, contribution] of [
      [TAURI_REACT_EXPORTER_PLUGIN_ID, exporterContribution()],
      [EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID, expoExporterContribution()],
      [FLUTTER_EXPORTER_PLUGIN_ID, flutterExporterContribution()],
      [
        NEXTJS_EXPORTER_PLUGIN_ID,
        bundledV1ExporterContribution(NEXTJS_EXPORTER_PLUGIN_ID, NEXTJS_EXPORTER.exporterId)
      ],
      [
        CAPACITOR_EXPORTER_PLUGIN_ID,
        bundledV1ExporterContribution(CAPACITOR_EXPORTER_PLUGIN_ID, CAPACITOR_EXPORTER.exporterId)
      ],
      [
        ELECTRON_EXPORTER_PLUGIN_ID,
        bundledV1ExporterContribution(ELECTRON_EXPORTER_PLUGIN_ID, ELECTRON_EXPORTER.exporterId)
      ]
    ] as const) {
      expect(inspectPluginExporterMCPExposure(pluginId, contribution)).toMatchObject({
        ok: false,
        status: 'mcp-exposure-disabled'
      })
      expect(supportsPluginExporterCancellation(pluginId, contribution)).toBe(false)
    }
    expect(
      inspectPluginExporterMCPExposure(DESIGN_TOKENS_EXPORTER_PLUGIN_ID, designTokensContribution())
    ).toEqual({ ok: true, status: 'compatible' })
    expect(
      supportsPluginExporterCancellation(
        DESIGN_TOKENS_EXPORTER_PLUGIN_ID,
        designTokensContribution()
      )
    ).toBe(true)
    expect(
      inspectPluginExporterMCPExposure(
        VUE_EXPORTER_PLUGIN_ID,
        bundledV1ExporterContribution(VUE_EXPORTER_PLUGIN_ID, VUE_EXPORTER.exporterId)
      )
    ).toEqual({ ok: true, status: 'compatible' })
    expect(
      supportsPluginExporterCancellation(
        VUE_EXPORTER_PLUGIN_ID,
        bundledV1ExporterContribution(VUE_EXPORTER_PLUGIN_ID, VUE_EXPORTER.exporterId)
      )
    ).toBe(true)
  })

  test('fails disabled and blocked commands before invoking the injected host executor', async () => {
    const calls: string[] = []
    const contribution = commandContribution()
    const host = executors((kind, id) => calls.push(`${kind}:${id ?? ''}`))
    const manifest = bundledManifest(CLIPBOARD_TOOLKIT_PLUGIN_ID)

    await expect(
      runInstalledPluginCommand(EDITOR, installedPlugin(manifest, false), contribution, host)
    ).rejects.toThrow('Plugin is disabled')
    await expect(
      runInstalledPluginCommand(
        EDITOR,
        installedPlugin(manifest, true, 'Publisher key was revoked'),
        contribution,
        host
      )
    ).rejects.toThrow('Publisher key was revoked')
    expect(calls).toEqual([])
  })

  test('fails disabled and blocked exporters before invoking the injected host executor', async () => {
    const calls: string[] = []
    const contribution = exporterContribution()
    const host = executors((kind, id) => calls.push(`${kind}:${id ?? ''}`))
    const manifest = bundledManifest(TAURI_REACT_EXPORTER_PLUGIN_ID)

    await expect(
      runInstalledPluginExporter(EDITOR, installedPlugin(manifest, false), contribution, host)
    ).rejects.toThrow('Plugin is disabled')
    await expect(
      runInstalledPluginExporter(
        EDITOR,
        installedPlugin(manifest, true, 'Local activation policy blocked this plugin'),
        contribution,
        host
      )
    ).rejects.toThrow('Local activation policy blocked this plugin')
    expect(calls).toEqual([])
  })

  test('fails exporter identity and extension mismatches before resolving an executor', async () => {
    const calls: string[] = []
    const host = executors((kind, id) => calls.push(`${kind}:${id ?? ''}`))
    const trusted = exporterContribution()
    const cases: Array<{
      manifestPluginId: string
      contribution: DeclarativeExporterContributionV1
      message: string
    }> = [
      {
        manifestPluginId: TAURI_REACT_EXPORTER_PLUGIN_ID,
        contribution: { ...trusted, adapterId: 'publisher.unreviewed-exporter' },
        message: 'Plugin exporter adapter is not trusted'
      },
      {
        manifestPluginId: 'publisher.other',
        contribution: trusted,
        message: 'is not authorized to use adapter'
      },
      {
        manifestPluginId: TAURI_REACT_EXPORTER_PLUGIN_ID,
        contribution: { ...trusted, exporterId: 'different-exporter' },
        message: 'does not authorize exporter'
      },
      {
        manifestPluginId: TAURI_REACT_EXPORTER_PLUGIN_ID,
        contribution: { ...trusted, fileExtension: '.tar' },
        message: `requires ${TAURI_REACT_EXPORTER.fileExtension} output`
      }
    ]

    for (const testCase of cases) {
      const manifest = bundledManifest(TAURI_REACT_EXPORTER_PLUGIN_ID)
      manifest.plugin.id = testCase.manifestPluginId
      manifest.contributions.exporters = [testCase.contribution]
      await expect(
        runInstalledPluginExporter(
          EDITOR,
          installedPlugin(manifest, true),
          testCase.contribution,
          host
        )
      ).rejects.toThrow(testCase.message)
    }

    expect(calls).toEqual([])
  })

  test('fails closed when the exact trusted adapter has no registered executor', async () => {
    const contribution = exporterContribution()
    const resolvedAdapterIds: string[] = []
    const host = {
      async clipboard() {
        return 'unused'
      },
      resolveExporter(adapterId) {
        resolvedAdapterIds.push(adapterId)
        return undefined
      }
    } satisfies AppPluginHostExecutors

    await expect(
      runInstalledPluginExporter(
        EDITOR,
        installedPlugin(bundledManifest(TAURI_REACT_EXPORTER_PLUGIN_ID), true),
        contribution,
        host
      )
    ).rejects.toThrow(`Plugin exporter executor is unavailable: ${contribution.adapterId}`)
    expect(resolvedAdapterIds).toEqual([contribution.adapterId])
  })

  test('forwards cancellation to the trusted exporter and rejects pre-aborted calls', async () => {
    const contribution = exporterContribution()
    const plugin = installedPlugin(bundledManifest(TAURI_REACT_EXPORTER_PLUGIN_ID), true)
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    let resolveCount = 0
    const host = {
      async clipboard() {
        return 'unused'
      },
      resolveExporter() {
        resolveCount += 1
        return async (_editor, signal) => {
          receivedSignal = signal
          return { fileName: 'demo.zip', fileCount: 1, warnings: [], saved: true }
        }
      }
    } satisfies AppPluginHostExecutors

    await expect(
      runInstalledPluginExporter(EDITOR, plugin, contribution, host, controller.signal)
    ).resolves.toMatchObject({ status: 'completed' })
    expect(receivedSignal).not.toBe(controller.signal)
    expect(receivedSignal?.aborted).toBe(false)
    expect(resolveCount).toBe(1)

    controller.abort()
    await expect(
      runInstalledPluginExporter(EDITOR, plugin, contribution, host, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(resolveCount).toBe(1)
  })

  test('invokes reviewed executors only after all declaration and identity gates pass', async () => {
    const calls: string[] = []
    const host = executors((kind, id) => calls.push(`${kind}:${id ?? ''}`))
    const command = commandContribution()
    const exporter = exporterContribution()
    const expoExporter = expoExporterContribution()
    const flutterExporter = flutterExporterContribution()

    await expect(
      runInstalledPluginCommand(
        EDITOR,
        installedPlugin(bundledManifest(CLIPBOARD_TOOLKIT_PLUGIN_ID), true),
        command,
        host
      )
    ).resolves.toEqual({ status: 'completed', message: `ran ${command.commandId}` })
    await expect(
      runInstalledPluginExporter(
        EDITOR,
        installedPlugin(bundledManifest(TAURI_REACT_EXPORTER_PLUGIN_ID), true),
        exporter,
        host
      )
    ).resolves.toEqual(completedExportResult())
    await expect(
      runInstalledPluginExporter(
        EDITOR,
        installedPlugin(bundledManifest(FLUTTER_EXPORTER_PLUGIN_ID), true),
        flutterExporter,
        host
      )
    ).resolves.toEqual(completedExportResult())
    await expect(
      runInstalledPluginExporter(
        EDITOR,
        installedPlugin(bundledManifest(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID), true),
        expoExporter,
        host
      )
    ).resolves.toEqual(completedExportResult())
    expect(calls).toEqual([
      `clipboard:${command.commandId}`,
      `exporter-resolve:${exporter.adapterId}`,
      `exporter:${exporter.adapterId}`,
      `exporter-resolve:${flutterExporter.adapterId}`,
      `exporter:${flutterExporter.adapterId}`,
      `exporter-resolve:${expoExporter.adapterId}`,
      `exporter:${expoExporter.adapterId}`
    ])
  })

  test('enforces exact v2 permissions and exporter outputs before resolving host code', () => {
    const command = accessibilityContribution()
    const exporter = designTokensContribution()

    expect(inspectPluginCommandCompatibility(ACCESSIBILITY_AUDIT_PLUGIN_ID, command)).toEqual({
      ok: true,
      status: 'compatible'
    })
    expect(
      inspectPluginCommandCompatibility(ACCESSIBILITY_AUDIT_PLUGIN_ID, {
        ...command,
        permissions: []
      })
    ).toMatchObject({ ok: false, status: 'permissions-mismatch' })
    expect(
      inspectPluginCommandCompatibility(ACCESSIBILITY_AUDIT_PLUGIN_ID, {
        ...command,
        permissions: ['document.read', 'file.save']
      })
    ).toMatchObject({ ok: false, status: 'permissions-mismatch' })

    expect(inspectPluginExporterCompatibility(DESIGN_TOKENS_EXPORTER_PLUGIN_ID, exporter)).toEqual({
      ok: true,
      status: 'compatible'
    })
    expect(
      inspectPluginExporterCompatibility(DESIGN_TOKENS_EXPORTER_PLUGIN_ID, {
        ...exporter,
        outputs: [{ extension: '.json', mimeType: 'text/plain' }]
      })
    ).toMatchObject({ ok: false, status: 'outputs-mismatch' })
    expect(exporter.outputs).toEqual(DESIGN_TOKENS_EXPORTER.outputs)
  })

  test('validates v2 arguments before execution and structured result data afterward', async () => {
    const contribution = accessibilityContribution()
    const plugin = installedPlugin(bundledManifestV2(ACCESSIBILITY_AUDIT_PLUGIN_ID), true)
    const received: unknown[] = []
    let resultData: JSONValue = {
      kind: 'static-accessibility-audit',
      scope: 'document',
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      issueCount: 0,
      truncated: false,
      issues: [],
      notEvaluated: []
    }
    const host = {
      async clipboard() {
        return 'unused'
      },
      resolveCommand() {
        return async (_editor, args) => {
          received.push(args)
          return { status: 'completed' as const, message: 'audit', data: resultData }
        }
      },
      resolveExporter() {
        return undefined
      }
    } satisfies AppPluginHostExecutors

    await expect(
      runInstalledPluginCommand(EDITOR, plugin, contribution, host, {})
    ).resolves.toEqual(expect.objectContaining({ status: 'completed', data: resultData }))
    expect(received).toEqual([{}])
    await expect(
      runInstalledPluginCommand(EDITOR, plugin, contribution, host, { unexpected: true })
    ).rejects.toThrow('not supported')
    expect(received).toHaveLength(1)

    const issue = {
      ruleId: 'contrast',
      severity: 'warning',
      message: 'x'.repeat(1_000),
      nodeId: 'node',
      nodeName: 'Node',
      nodePath: []
    }
    resultData = {
      kind: 'static-accessibility-audit',
      scope: 'document',
      errorCount: 0,
      warningCount: 600,
      infoCount: 0,
      issueCount: 600,
      truncated: false,
      issues: Array.from({ length: 600 }, () => issue),
      notEvaluated: []
    }
    await expect(runInstalledPluginCommand(EDITOR, plugin, contribution, host, {})).rejects.toThrow(
      'contract limit'
    )
    const receivedBeforeDeclarationTampering = received.length

    const widened: DeclarativeCommandContributionV2 = {
      ...structuredClone(contribution),
      parameters: {
        ...structuredClone(contribution.parameters),
        schema: {
          ...structuredClone(contribution.parameters.schema),
          properties: { secret: { type: 'string' } }
        }
      }
    }
    await expect(
      runInstalledPluginCommand(EDITOR, plugin, widened, host, { secret: 'value' })
    ).rejects.toThrow('not declared')

    let toJSONCalled = false
    const forged = Object.assign(widened, {
      toJSON() {
        toJSONCalled = true
        return contribution
      }
    })
    await expect(
      runInstalledPluginCommand(EDITOR, plugin, forged, host, { secret: 'value' })
    ).rejects.toThrow('not declared')
    expect(toJSONCalled).toBe(false)
    expect(received).toHaveLength(receivedBeforeDeclarationTampering)

    let getterCalled = false
    const accessor = structuredClone(contribution) as DeclarativeCommandContributionV2
    Object.defineProperty(accessor, 'parameters', {
      enumerable: true,
      get() {
        getterCalled = true
        return contribution.parameters
      }
    })
    await expect(runInstalledPluginCommand(EDITOR, plugin, accessor, host, {})).rejects.toThrow(
      'enumerable data field'
    )
    expect(getterCalled).toBe(false)
    expect(received).toHaveLength(receivedBeforeDeclarationTampering)
  })
})
