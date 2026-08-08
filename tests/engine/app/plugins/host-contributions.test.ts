import { describe, expect, test } from 'bun:test'

import type {
  DeclarativeCommandContributionV1,
  DeclarativeExporterContributionV1,
  PluginManifestPayloadV1
} from '@open-pencil/core/plugins'

import type { EditorStore } from '@/app/editor/active-store'
import {
  createBundledPluginCatalog,
  inspectPluginCommandCompatibility,
  inspectPluginExporterCompatibility,
  resolveTrustedPluginExporterExecutor,
  runInstalledPluginCommand,
  runInstalledPluginExporter,
  type AppPluginHostExecutors,
  type InstalledAppPlugin
} from '@/app/plugins'
import { exportCurrentDocumentAsExpoReactNativeSource } from '@/app/plugins/host/expo-react-native-exporter'
import { exportCurrentDocumentAsFlutterSource } from '@/app/plugins/host/flutter-exporter'
import {
  CLIPBOARD_COMMANDS,
  CLIPBOARD_TOOLKIT_PLUGIN_ID,
  EXPO_REACT_NATIVE_EXPORTER,
  EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
  FLUTTER_EXPORTER,
  FLUTTER_EXPORTER_PLUGIN_ID,
  TAURI_REACT_EXPORTER,
  TAURI_REACT_EXPORTER_PLUGIN_ID
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

function installedPlugin(
  manifest: PluginManifestPayloadV1,
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
    expect(receivedSignal).toBe(controller.signal)
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
    ).resolves.toEqual({
      status: 'completed',
      message: 'Exported 9 files to demo.zip'
    })
    await expect(
      runInstalledPluginExporter(
        EDITOR,
        installedPlugin(bundledManifest(FLUTTER_EXPORTER_PLUGIN_ID), true),
        flutterExporter,
        host
      )
    ).resolves.toEqual({
      status: 'completed',
      message: 'Exported 9 files to demo.zip'
    })
    await expect(
      runInstalledPluginExporter(
        EDITOR,
        installedPlugin(bundledManifest(EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID), true),
        expoExporter,
        host
      )
    ).resolves.toEqual({
      status: 'completed',
      message: 'Exported 9 files to demo.zip'
    })
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
})
