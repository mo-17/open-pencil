import type {
  DeclarativeCommandContributionV1,
  DeclarativeExporterContributionV1,
  PluginManifestPayloadV1
} from '@open-pencil/core/plugins'

import type { EditorStore } from '@/app/editor/active-store'

import type { InstalledAppPlugin } from '../types'
import { executeClipboardCommand } from './clipboard'
import { exportCurrentDocumentAsExpoReactNativeSource } from './expo-react-native-exporter'
import { throwIfPluginExportAborted } from './exporter-abort'
import type { AppPluginExporterExecutionResult } from './exporter-types'
import { exportCurrentDocumentAsFlutterSource } from './flutter-exporter'
import {
  CLIPBOARD_COMMANDS,
  CLIPBOARD_TOOLKIT_PLUGIN_ID,
  EXPO_REACT_NATIVE_EXPORTER,
  EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
  FLUTTER_EXPORTER,
  FLUTTER_EXPORTER_PLUGIN_ID,
  TAURI_REACT_EXPORTER,
  TAURI_REACT_EXPORTER_PLUGIN_ID
} from './ids'
import { exportCurrentDocumentAsTauriReactSource } from './tauri-react-exporter'

export type AppPluginHostContributionKind = 'command' | 'exporter'
export type { AppPluginExporterExecutionResult } from './exporter-types'
export type AppPluginHostContributionCompatibilityStatus =
  | 'compatible'
  | 'untrusted-adapter'
  | 'plugin-identity-mismatch'
  | 'contribution-identity-mismatch'
  | 'file-extension-mismatch'

export type AppPluginHostContributionCompatibility =
  | Readonly<{ ok: true; status: 'compatible' }>
  | Readonly<{
      ok: false
      status: Exclude<AppPluginHostContributionCompatibilityStatus, 'compatible'>
      reason: string
    }>

export interface AppPluginHostContributionCompatibilityFailure {
  kind: AppPluginHostContributionKind
  contributionId: string
  status: Exclude<AppPluginHostContributionCompatibilityStatus, 'compatible'>
  reason: string
}

export interface AppPluginHostExecutionResult {
  status: 'completed' | 'cancelled'
  message: string
}

interface TrustedCommandAdapter {
  pluginId: string
  commandId: string
}

interface TrustedExporterAdapter {
  pluginId: string
  exporterId: string
  fileExtension: string
  execute: AppPluginExporterExecutor
}

export type AppPluginExporterExecutor = (
  editor: EditorStore,
  signal?: AbortSignal
) => Promise<AppPluginExporterExecutionResult>

export interface AppPluginHostExecutors {
  clipboard(editor: EditorStore, commandId: string): Promise<string>
  resolveExporter(adapterId: string): AppPluginExporterExecutor | undefined
}

const TRUSTED_COMMAND_ADAPTERS = new Map<string, TrustedCommandAdapter>(
  Object.values(CLIPBOARD_COMMANDS).map(({ commandId, adapterId }) => [
    adapterId,
    { pluginId: CLIPBOARD_TOOLKIT_PLUGIN_ID, commandId }
  ])
)

const TRUSTED_EXPORTER_ADAPTERS = new Map<string, TrustedExporterAdapter>([
  [
    TAURI_REACT_EXPORTER.adapterId,
    {
      pluginId: TAURI_REACT_EXPORTER_PLUGIN_ID,
      exporterId: TAURI_REACT_EXPORTER.exporterId,
      fileExtension: TAURI_REACT_EXPORTER.fileExtension,
      execute: exportCurrentDocumentAsTauriReactSource
    }
  ],
  [
    EXPO_REACT_NATIVE_EXPORTER.adapterId,
    {
      pluginId: EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
      exporterId: EXPO_REACT_NATIVE_EXPORTER.exporterId,
      fileExtension: EXPO_REACT_NATIVE_EXPORTER.fileExtension,
      execute: exportCurrentDocumentAsExpoReactNativeSource
    }
  ],
  [
    FLUTTER_EXPORTER.adapterId,
    {
      pluginId: FLUTTER_EXPORTER_PLUGIN_ID,
      exporterId: FLUTTER_EXPORTER.exporterId,
      fileExtension: FLUTTER_EXPORTER.fileExtension,
      execute: exportCurrentDocumentAsFlutterSource
    }
  ]
])

export function resolveTrustedPluginExporterExecutor(
  adapterId: string
): AppPluginExporterExecutor | undefined {
  return TRUSTED_EXPORTER_ADAPTERS.get(adapterId)?.execute
}

const DEFAULT_EXECUTORS: AppPluginHostExecutors = Object.freeze({
  clipboard: executeClipboardCommand,
  resolveExporter: resolveTrustedPluginExporterExecutor
})

function incompatible(
  status: Exclude<AppPluginHostContributionCompatibilityStatus, 'compatible'>,
  reason: string
): AppPluginHostContributionCompatibility {
  return { ok: false, status, reason }
}

export function inspectPluginCommandCompatibility(
  pluginId: string,
  contribution: DeclarativeCommandContributionV1
): AppPluginHostContributionCompatibility {
  const adapter = TRUSTED_COMMAND_ADAPTERS.get(contribution.adapterId)
  if (!adapter) {
    return incompatible(
      'untrusted-adapter',
      `Plugin command adapter is not trusted: ${contribution.adapterId}`
    )
  }
  if (adapter.pluginId !== pluginId) {
    return incompatible(
      'plugin-identity-mismatch',
      `Plugin ${pluginId} is not authorized to use adapter ${contribution.adapterId}`
    )
  }
  if (adapter.commandId !== contribution.commandId) {
    return incompatible(
      'contribution-identity-mismatch',
      `Adapter ${contribution.adapterId} does not authorize command ${contribution.commandId}`
    )
  }
  return { ok: true, status: 'compatible' }
}

export function inspectPluginExporterCompatibility(
  pluginId: string,
  contribution: DeclarativeExporterContributionV1
): AppPluginHostContributionCompatibility {
  const adapter = TRUSTED_EXPORTER_ADAPTERS.get(contribution.adapterId)
  if (!adapter) {
    return incompatible(
      'untrusted-adapter',
      `Plugin exporter adapter is not trusted: ${contribution.adapterId}`
    )
  }
  if (adapter.pluginId !== pluginId) {
    return incompatible(
      'plugin-identity-mismatch',
      `Plugin ${pluginId} is not authorized to use adapter ${contribution.adapterId}`
    )
  }
  if (adapter.exporterId !== contribution.exporterId) {
    return incompatible(
      'contribution-identity-mismatch',
      `Adapter ${contribution.adapterId} does not authorize exporter ${contribution.exporterId}`
    )
  }
  if (adapter.fileExtension !== contribution.fileExtension) {
    return incompatible(
      'file-extension-mismatch',
      `Adapter ${contribution.adapterId} requires ${adapter.fileExtension} output`
    )
  }
  return { ok: true, status: 'compatible' }
}

export function inspectPluginHostContributionsCompatibility(
  pluginId: string,
  contributions: Pick<PluginManifestPayloadV1['contributions'], 'commands' | 'exporters'>
): readonly AppPluginHostContributionCompatibilityFailure[] {
  const failures: AppPluginHostContributionCompatibilityFailure[] = []
  for (const contribution of contributions.commands ?? []) {
    const compatibility = inspectPluginCommandCompatibility(pluginId, contribution)
    if (!compatibility.ok) {
      failures.push({
        kind: 'command',
        contributionId: contribution.commandId,
        status: compatibility.status,
        reason: compatibility.reason
      })
    }
  }
  for (const contribution of contributions.exporters ?? []) {
    const compatibility = inspectPluginExporterCompatibility(pluginId, contribution)
    if (!compatibility.ok) {
      failures.push({
        kind: 'exporter',
        contributionId: contribution.exporterId,
        status: compatibility.status,
        reason: compatibility.reason
      })
    }
  }
  return failures
}

function requireRunnable(plugin: InstalledAppPlugin): string {
  const pluginId = plugin.package.manifest.plugin.id
  if (!plugin.enabled) throw new Error(`Plugin is disabled: ${pluginId}`)
  if (plugin.blockedReason) throw new Error(plugin.blockedReason)
  return pluginId
}

function requireDeclaredCommand(
  plugin: InstalledAppPlugin,
  contribution: DeclarativeCommandContributionV1
): void {
  const declared = plugin.package.manifest.contributions.commands?.find(
    (candidate) => candidate.commandId === contribution.commandId
  )
  if (!declared || declared.adapterId !== contribution.adapterId) {
    throw new Error(`Command is not declared by the installed plugin: ${contribution.commandId}`)
  }
}

function requireDeclaredExporter(
  plugin: InstalledAppPlugin,
  contribution: DeclarativeExporterContributionV1
): void {
  const declared = plugin.package.manifest.contributions.exporters?.find(
    (candidate) => candidate.exporterId === contribution.exporterId
  )
  if (
    !declared ||
    declared.adapterId !== contribution.adapterId ||
    declared.fileExtension !== contribution.fileExtension
  ) {
    throw new Error(`Exporter is not declared by the installed plugin: ${contribution.exporterId}`)
  }
}

export async function runInstalledPluginCommand(
  editor: EditorStore,
  plugin: InstalledAppPlugin,
  contribution: DeclarativeCommandContributionV1,
  executors: AppPluginHostExecutors = DEFAULT_EXECUTORS
): Promise<AppPluginHostExecutionResult> {
  const pluginId = requireRunnable(plugin)
  requireDeclaredCommand(plugin, contribution)
  const compatibility = inspectPluginCommandCompatibility(pluginId, contribution)
  if (!compatibility.ok) throw new Error(compatibility.reason)
  return {
    status: 'completed',
    message: await executors.clipboard(editor, contribution.commandId)
  }
}

export async function runInstalledPluginExporter(
  editor: EditorStore,
  plugin: InstalledAppPlugin,
  contribution: DeclarativeExporterContributionV1,
  executors: AppPluginHostExecutors = DEFAULT_EXECUTORS,
  signal?: AbortSignal
): Promise<AppPluginHostExecutionResult> {
  throwIfPluginExportAborted(signal)
  const pluginId = requireRunnable(plugin)
  requireDeclaredExporter(plugin, contribution)
  const compatibility = inspectPluginExporterCompatibility(pluginId, contribution)
  if (!compatibility.ok) throw new Error(compatibility.reason)
  const execute = executors.resolveExporter(contribution.adapterId)
  if (!execute) {
    throw new Error(`Plugin exporter executor is unavailable: ${contribution.adapterId}`)
  }
  throwIfPluginExportAborted(signal)
  const result = await execute(editor, signal)
  return result.saved
    ? {
        status: 'completed',
        message: `Exported ${result.fileCount} files to ${result.fileName}${
          result.warnings.length > 0 ? ` with ${result.warnings.length} warning(s)` : ''
        }`
      }
    : { status: 'cancelled', message: 'Export cancelled' }
}
