import type {
  DeclarativeCommandContributionV2,
  DeclarativeExporterContributionV1,
  DeclarativeExporterContributionV2,
  PluginExporterOutputV2,
  PluginHostPermissionV2,
  PluginObjectParameterSchemaV2,
  PluginStorageProviderContributionV2
} from '@open-pencil/plugin-contracts'
import { parsePluginObjectParameterValue } from '@open-pencil/plugin-contracts'
import type { JSONObject, JSONValue } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'

import type {
  AppPluginCommandContribution,
  AppPluginExporterContribution,
  InstalledAppPlugin
} from '../types'
import { runStaticAccessibilityAudit } from './accessibility-audit'
import {
  APPLICATION_SECURITY_READINESS_HOST_CONTRACT,
  runApplicationSecurityReadiness
} from './application-security-readiness'
import { exportCurrentDocumentAsCapacitorSource } from './capacitor-exporter'
import { executeClipboardCommand } from './clipboard'
import {
  plainDataContribution,
  sameJSONAuthority,
  type PluginContributionDataRecord
} from './contribution-authority'
import { REVIEWED_DEPLOYMENT_PLUGINS } from './deployment/contract'
import { buildDeploymentPluginPlan } from './deployment/provider'
import { runStaticDesignSystemAudit } from './design-system-audit'
import { exportCurrentDocumentDesignTokens } from './design-tokens-exporter'
import { exportCurrentDocumentAsElectronSource } from './electron-exporter'
import { exportCurrentDocumentAsExpoReactNativeSource } from './expo-react-native-exporter'
import { createPluginExportResultData } from './export-result'
import { runAppPluginExportSession } from './export-session'
import { throwIfPluginExportAborted } from './exporter-abort'
import type { AppPluginExporterExecutionResult } from './exporter-types'
import { exportCurrentDocumentAsFigmaProjection } from './figma-projection-exporter'
import { exportCurrentDocumentAsFlutterSource } from './flutter-exporter'
import {
  AI_POPOUT_COMMAND,
  AI_POPOUT_PLUGIN_ID,
  CAPACITOR_EXPORTER,
  CAPACITOR_EXPORTER_PLUGIN_ID,
  CLIPBOARD_COMMANDS,
  CLIPBOARD_TOOLKIT_PLUGIN_ID,
  COMPILER_PREVIEW_POPOUT_COMMAND,
  COMPILER_PREVIEW_POPOUT_PLUGIN_ID,
  ACCESSIBILITY_AUDIT_COMMAND,
  ACCESSIBILITY_AUDIT_PLUGIN_ID,
  DESIGN_SYSTEM_AUDIT_COMMAND,
  DESIGN_SYSTEM_AUDIT_PLUGIN_ID,
  DESIGN_TOKENS_EXPORTER,
  DESIGN_TOKENS_EXPORTER_PLUGIN_ID,
  ELECTRON_EXPORTER,
  ELECTRON_EXPORTER_PLUGIN_ID,
  EXPO_REACT_NATIVE_EXPORTER,
  EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
  FLUTTER_EXPORTER,
  FLUTTER_EXPORTER_PLUGIN_ID,
  FIGMA_PROJECTION_EXPORTER,
  FIGMA_PROJECTION_EXPORTER_PLUGIN_ID,
  NEXTJS_EXPORTER,
  NEXTJS_EXPORTER_PLUGIN_ID,
  TAURI_REACT_EXPORTER,
  TAURI_REACT_EXPORTER_PLUGIN_ID,
  VUE_EXPORTER,
  VUE_EXPORTER_PLUGIN_ID
} from './ids'
import { exportCurrentDocumentAsNextJsSource } from './nextjs-exporter'
import {
  inspectPluginStorageProviderCompatibility,
  type AppPluginStorageProviderCompatibilityStatus
} from './storage-provider'
import { exportCurrentDocumentAsTauriReactSource } from './tauri-react-exporter'
import { exportCurrentDocumentAsVueSource } from './vue/source-exporter'

export {
  inspectPluginStorageProviderCompatibility,
  type AppPluginStorageProviderCompatibility,
  type AppPluginStorageProviderCompatibilityStatus
} from './storage-provider'

export type AppPluginHostContributionKind = 'command' | 'exporter' | 'storage-provider'
export type { AppPluginExporterExecutionResult } from './exporter-types'
export type AppPluginHostContributionCompatibilityStatus =
  | 'compatible'
  | 'untrusted-adapter'
  | 'plugin-identity-mismatch'
  | 'contribution-identity-mismatch'
  | 'manifest-version-mismatch'
  | 'file-extension-mismatch'
  | 'permissions-mismatch'
  | 'outputs-mismatch'
  | 'mcp-exposure-disabled'
  | Exclude<AppPluginStorageProviderCompatibilityStatus, 'compatible'>

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
  data?: JSONValue
}

interface TrustedCommandAdapter {
  pluginId: string
  commandId: string
  schemaVersion: 1 | 2
  permissions?: readonly PluginHostPermissionV2[]
  mcpExposure: 'enabled' | 'disabled'
  mcpText?: Readonly<{ title: string; description: string }>
}

interface TrustedExporterAdapter {
  pluginId: string
  exporterId: string
  schemaVersion: 1 | 2
  fileExtension?: string
  permissions?: readonly PluginHostPermissionV2[]
  outputs?: readonly PluginExporterOutputV2[]
  mcpExposure: 'enabled' | 'disabled'
  supportsCancellation: boolean
  execute: AppPluginExporterExecutor
}

export type AppPluginExporterExecutor = (
  editor: EditorStore,
  signal?: AbortSignal,
  args?: JSONObject
) => Promise<AppPluginExporterExecutionResult>

export type AppPluginCommandExecutor = (
  editor: EditorStore,
  args: JSONObject,
  signal?: AbortSignal
) => Promise<AppPluginHostExecutionResult> | AppPluginHostExecutionResult

export interface AppPluginHostExecutors {
  clipboard(editor: EditorStore, commandId: string): Promise<string>
  resolveCommand?(adapterId: string): AppPluginCommandExecutor | undefined
  resolveExporter(adapterId: string): AppPluginExporterExecutor | undefined
}

function sourceProjectExporterExecutor(
  execute: (editor: EditorStore, signal?: AbortSignal) => Promise<AppPluginExporterExecutionResult>
): AppPluginExporterExecutor {
  return (editor, signal) => execute(editor, signal)
}

const TRUSTED_COMMAND_ADAPTERS = new Map<string, TrustedCommandAdapter>([
  ...Object.values(CLIPBOARD_COMMANDS).map(
    ({ commandId, adapterId }) =>
      [
        adapterId,
        {
          pluginId: CLIPBOARD_TOOLKIT_PLUGIN_ID,
          commandId,
          schemaVersion: 1,
          mcpExposure: 'enabled'
        }
      ] as const
  ),
  [
    ACCESSIBILITY_AUDIT_COMMAND.adapterId,
    {
      pluginId: ACCESSIBILITY_AUDIT_PLUGIN_ID,
      commandId: ACCESSIBILITY_AUDIT_COMMAND.commandId,
      schemaVersion: 2,
      permissions: ACCESSIBILITY_AUDIT_COMMAND.permissions,
      mcpExposure: 'enabled'
    }
  ] as const,
  [
    DESIGN_SYSTEM_AUDIT_COMMAND.adapterId,
    {
      pluginId: DESIGN_SYSTEM_AUDIT_PLUGIN_ID,
      commandId: DESIGN_SYSTEM_AUDIT_COMMAND.commandId,
      schemaVersion: 2,
      permissions: DESIGN_SYSTEM_AUDIT_COMMAND.permissions,
      mcpExposure: 'enabled'
    }
  ] as const,
  [
    APPLICATION_SECURITY_READINESS_HOST_CONTRACT.command.adapterId,
    {
      pluginId: APPLICATION_SECURITY_READINESS_HOST_CONTRACT.pluginId,
      commandId: APPLICATION_SECURITY_READINESS_HOST_CONTRACT.command.commandId,
      schemaVersion: 2,
      permissions: APPLICATION_SECURITY_READINESS_HOST_CONTRACT.command.permissions,
      mcpExposure: 'enabled',
      mcpText: Object.freeze({
        title: 'Run application security readiness audit',
        description:
          'Run a bounded, local, read-only static production-readiness review. It does not modify the document or any remote system and does not return document content or secrets.'
      })
    }
  ] as const,
  [
    COMPILER_PREVIEW_POPOUT_COMMAND.adapterId,
    {
      pluginId: COMPILER_PREVIEW_POPOUT_PLUGIN_ID,
      commandId: COMPILER_PREVIEW_POPOUT_COMMAND.commandId,
      schemaVersion: 2,
      permissions: COMPILER_PREVIEW_POPOUT_COMMAND.permissions,
      mcpExposure: 'disabled'
    }
  ] as const,
  [
    AI_POPOUT_COMMAND.adapterId,
    {
      pluginId: AI_POPOUT_PLUGIN_ID,
      commandId: AI_POPOUT_COMMAND.commandId,
      schemaVersion: 2,
      permissions: AI_POPOUT_COMMAND.permissions,
      mcpExposure: 'disabled'
    }
  ] as const,
  ...REVIEWED_DEPLOYMENT_PLUGINS.map(
    (definition) =>
      [
        definition.mcpSafePlan.adapterId,
        {
          pluginId: definition.pluginId,
          commandId: definition.mcpSafePlan.commandId,
          schemaVersion: 2 as const,
          permissions: definition.mcpSafePlan.permissions,
          mcpExposure: 'enabled' as const,
          mcpText: Object.freeze({
            title: definition.mcpSafePlan.name,
            description: definition.mcpSafePlan.description
          })
        }
      ] as const
  )
])

const TRUSTED_EXPORTER_ADAPTERS = new Map<string, TrustedExporterAdapter>([
  [
    TAURI_REACT_EXPORTER.adapterId,
    {
      pluginId: TAURI_REACT_EXPORTER_PLUGIN_ID,
      exporterId: TAURI_REACT_EXPORTER.exporterId,
      schemaVersion: 1,
      fileExtension: TAURI_REACT_EXPORTER.fileExtension,
      // Source compilation is synchronous and cannot cooperatively stop after
      // an MCP timeout. UI/menu execution remains available.
      mcpExposure: 'disabled',
      supportsCancellation: false,
      execute: exportCurrentDocumentAsTauriReactSource
    }
  ],
  [
    EXPO_REACT_NATIVE_EXPORTER.adapterId,
    {
      pluginId: EXPO_REACT_NATIVE_EXPORTER_PLUGIN_ID,
      exporterId: EXPO_REACT_NATIVE_EXPORTER.exporterId,
      schemaVersion: 1,
      fileExtension: EXPO_REACT_NATIVE_EXPORTER.fileExtension,
      mcpExposure: 'disabled',
      supportsCancellation: false,
      execute: exportCurrentDocumentAsExpoReactNativeSource
    }
  ],
  [
    FLUTTER_EXPORTER.adapterId,
    {
      pluginId: FLUTTER_EXPORTER_PLUGIN_ID,
      exporterId: FLUTTER_EXPORTER.exporterId,
      schemaVersion: 1,
      fileExtension: FLUTTER_EXPORTER.fileExtension,
      mcpExposure: 'disabled',
      supportsCancellation: false,
      execute: exportCurrentDocumentAsFlutterSource
    }
  ],
  [
    DESIGN_TOKENS_EXPORTER.adapterId,
    {
      pluginId: DESIGN_TOKENS_EXPORTER_PLUGIN_ID,
      exporterId: DESIGN_TOKENS_EXPORTER.exporterId,
      schemaVersion: 2,
      permissions: DESIGN_TOKENS_EXPORTER.permissions,
      outputs: DESIGN_TOKENS_EXPORTER.outputs,
      mcpExposure: 'enabled',
      supportsCancellation: true,
      execute: (editor, signal) => exportCurrentDocumentDesignTokens(editor, signal)
    }
  ],
  [
    FIGMA_PROJECTION_EXPORTER.adapterId,
    {
      pluginId: FIGMA_PROJECTION_EXPORTER_PLUGIN_ID,
      exporterId: FIGMA_PROJECTION_EXPORTER.exporterId,
      schemaVersion: 2,
      permissions: FIGMA_PROJECTION_EXPORTER.permissions,
      outputs: FIGMA_PROJECTION_EXPORTER.outputs,
      // Core .fig projection is currently synchronous and cannot cooperatively
      // stop after an MCP timeout. UI/menu execution remains available.
      mcpExposure: 'disabled',
      supportsCancellation: false,
      execute: (editor, signal) => exportCurrentDocumentAsFigmaProjection(editor, signal)
    }
  ],
  [
    NEXTJS_EXPORTER.adapterId,
    {
      pluginId: NEXTJS_EXPORTER_PLUGIN_ID,
      exporterId: NEXTJS_EXPORTER.exporterId,
      schemaVersion: 1,
      fileExtension: NEXTJS_EXPORTER.fileExtension,
      mcpExposure: 'disabled',
      supportsCancellation: false,
      execute: sourceProjectExporterExecutor(exportCurrentDocumentAsNextJsSource)
    }
  ],
  [
    CAPACITOR_EXPORTER.adapterId,
    {
      pluginId: CAPACITOR_EXPORTER_PLUGIN_ID,
      exporterId: CAPACITOR_EXPORTER.exporterId,
      schemaVersion: 1,
      fileExtension: CAPACITOR_EXPORTER.fileExtension,
      mcpExposure: 'disabled',
      supportsCancellation: false,
      execute: sourceProjectExporterExecutor(exportCurrentDocumentAsCapacitorSource)
    }
  ],
  [
    ELECTRON_EXPORTER.adapterId,
    {
      pluginId: ELECTRON_EXPORTER_PLUGIN_ID,
      exporterId: ELECTRON_EXPORTER.exporterId,
      schemaVersion: 1,
      fileExtension: ELECTRON_EXPORTER.fileExtension,
      mcpExposure: 'disabled',
      supportsCancellation: false,
      execute: sourceProjectExporterExecutor(exportCurrentDocumentAsElectronSource)
    }
  ],
  [
    VUE_EXPORTER.adapterId,
    {
      pluginId: VUE_EXPORTER_PLUGIN_ID,
      exporterId: VUE_EXPORTER.exporterId,
      schemaVersion: 1,
      fileExtension: VUE_EXPORTER.fileExtension,
      // Vue compilation and ZIP compression run in bounded module Workers.
      // Abort terminates the active isolate; the final write is signal-aware and atomic.
      mcpExposure: 'enabled',
      supportsCancellation: true,
      execute: sourceProjectExporterExecutor(exportCurrentDocumentAsVueSource)
    }
  ]
])

function resolveTrustedPluginCommandExecutor(
  adapterId: string
): AppPluginCommandExecutor | undefined {
  if (adapterId === ACCESSIBILITY_AUDIT_COMMAND.adapterId) {
    return (editor) => {
      const data = runStaticAccessibilityAudit(editor)
      const evaluated = data.errorCount + data.warningCount + data.infoCount
      return {
        status: 'completed',
        message: `Static accessibility audit found ${evaluated} issue(s): ${data.errorCount} error(s), ${data.warningCount} warning(s), and ${data.infoCount} info message(s).`,
        data
      }
    }
  }
  if (adapterId === DESIGN_SYSTEM_AUDIT_COMMAND.adapterId) {
    return async (editor, _args, signal) => {
      const data = await runStaticDesignSystemAudit(editor, { signal })
      return {
        status: 'completed',
        message: `Static design-system audit found ${data.issueCount} issue(s): ${data.warningCount} warning(s) and ${data.infoCount} info message(s).`,
        data
      }
    }
  }
  if (adapterId === APPLICATION_SECURITY_READINESS_HOST_CONTRACT.command.adapterId) {
    return async (editor, _args, signal) => {
      const data = await runApplicationSecurityReadiness(editor, { signal })
      return {
        status: 'completed',
        message: `Application security readiness: ${data.status}; ${data.errorCount} error(s) and ${data.warningCount} warning(s).`,
        data
      }
    }
  }
  if (adapterId === COMPILER_PREVIEW_POPOUT_COMMAND.adapterId) {
    return async () => {
      const { openActiveCompilerPreviewPopout } =
        await import('@/app/lowcode/preview-pane/popout/session')
      await openActiveCompilerPreviewPopout()
      return {
        status: 'completed',
        message: 'Opened the active compiler preview in a separate window.'
      }
    }
  }
  if (adapterId === AI_POPOUT_COMMAND.adapterId) {
    return async () => {
      const { openActiveAIPopout } = await import('@/app/ai/popout/session')
      await openActiveAIPopout()
      return {
        status: 'completed',
        message: 'Opened the active AI chat in a separate window.'
      }
    }
  }
  const deployment = REVIEWED_DEPLOYMENT_PLUGINS.find(
    (definition) => definition.mcpSafePlan.adapterId === adapterId
  )
  if (deployment) {
    return (editor, args) => ({
      status: 'completed',
      message: `${deployment.name} plan is ready for review; no build, credential read, or remote deployment was performed.`,
      data: buildDeploymentPluginPlan(editor, deployment, args)
    })
  }
  return undefined
}

export function resolveTrustedPluginExporterExecutor(
  adapterId: string
): AppPluginExporterExecutor | undefined {
  return TRUSTED_EXPORTER_ADAPTERS.get(adapterId)?.execute
}

const DEFAULT_EXECUTORS: AppPluginHostExecutors = Object.freeze({
  clipboard: executeClipboardCommand,
  resolveCommand: resolveTrustedPluginCommandExecutor,
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
  contribution: AppPluginCommandContribution
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
  const schemaVersion = commandSchemaVersion(contribution)
  if (schemaVersion !== adapter.schemaVersion) {
    return incompatible(
      'manifest-version-mismatch',
      `Adapter ${contribution.adapterId} requires a schema version ${adapter.schemaVersion} command`
    )
  }
  if (
    schemaVersion === 2 &&
    !samePermissions(
      (contribution as DeclarativeCommandContributionV2).permissions,
      adapter.permissions ?? []
    )
  ) {
    return incompatible(
      'permissions-mismatch',
      `Adapter ${contribution.adapterId} requires its exact trusted permission set`
    )
  }
  return { ok: true, status: 'compatible' }
}

export function trustedPluginCommandMCPText(
  pluginId: string,
  contribution: AppPluginCommandContribution
): Readonly<{ title: string; description: string }> | null {
  const adapter = TRUSTED_COMMAND_ADAPTERS.get(contribution.adapterId)
  if (
    !adapter ||
    adapter.pluginId !== pluginId ||
    adapter.commandId !== contribution.commandId ||
    commandSchemaVersion(contribution) !== adapter.schemaVersion
  ) {
    return null
  }
  return adapter.mcpText ?? null
}

export function inspectPluginCommandMCPExposure(
  pluginId: string,
  contribution: AppPluginCommandContribution
): AppPluginHostContributionCompatibility {
  const compatibility = inspectPluginCommandCompatibility(pluginId, contribution)
  if (!compatibility.ok) return compatibility
  const adapter = TRUSTED_COMMAND_ADAPTERS.get(contribution.adapterId)
  if (adapter?.mcpExposure !== 'enabled') {
    return incompatible(
      'mcp-exposure-disabled',
      `Plugin command adapter is not available to MCP: ${contribution.adapterId}`
    )
  }
  return { ok: true, status: 'compatible' }
}

export function inspectPluginExporterCompatibility(
  pluginId: string,
  contribution: AppPluginExporterContribution
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
  const schemaVersion = exporterSchemaVersion(contribution)
  if (schemaVersion !== adapter.schemaVersion) {
    return incompatible(
      'manifest-version-mismatch',
      `Adapter ${contribution.adapterId} requires a schema version ${adapter.schemaVersion} exporter`
    )
  }
  if (
    schemaVersion === 1 &&
    adapter.fileExtension !== (contribution as DeclarativeExporterContributionV1).fileExtension
  ) {
    return incompatible(
      'file-extension-mismatch',
      `Adapter ${contribution.adapterId} requires ${adapter.fileExtension} output`
    )
  }
  if (schemaVersion === 2) {
    const contributionV2 = contribution as DeclarativeExporterContributionV2
    if (!samePermissions(contributionV2.permissions, adapter.permissions ?? [])) {
      return incompatible(
        'permissions-mismatch',
        `Adapter ${contribution.adapterId} requires its exact trusted permission set`
      )
    }
    if (!sameOutputs(contributionV2.outputs, adapter.outputs ?? [])) {
      return incompatible(
        'outputs-mismatch',
        `Adapter ${contribution.adapterId} requires its exact trusted output set`
      )
    }
  }
  return { ok: true, status: 'compatible' }
}

export function inspectPluginExporterMCPExposure(
  pluginId: string,
  contribution: AppPluginExporterContribution
): AppPluginHostContributionCompatibility {
  const compatibility = inspectPluginExporterCompatibility(pluginId, contribution)
  if (!compatibility.ok) return compatibility
  const adapter = TRUSTED_EXPORTER_ADAPTERS.get(contribution.adapterId)
  if (adapter?.mcpExposure !== 'enabled' || !adapter.supportsCancellation) {
    return incompatible(
      'mcp-exposure-disabled',
      `Plugin exporter adapter is not available to MCP until it supports cooperative cancellation: ${contribution.adapterId}`
    )
  }
  return { ok: true, status: 'compatible' }
}

export function supportsPluginExporterCancellation(
  pluginId: string,
  contribution: AppPluginExporterContribution
): boolean {
  if (!inspectPluginExporterCompatibility(pluginId, contribution).ok) return false
  return TRUSTED_EXPORTER_ADAPTERS.get(contribution.adapterId)?.supportsCancellation === true
}

export function inspectPluginHostContributionsCompatibility(
  pluginId: string,
  contributions: Readonly<{
    commands?: readonly AppPluginCommandContribution[]
    exporters?: readonly AppPluginExporterContribution[]
    storageProviders?: readonly PluginStorageProviderContributionV2[]
  }>
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
  for (const contribution of contributions.storageProviders ?? []) {
    const compatibility = inspectPluginStorageProviderCompatibility(pluginId, contribution)
    if (!compatibility.ok) {
      failures.push({
        kind: 'storage-provider',
        contributionId: contribution.providerId,
        status: compatibility.status,
        reason: compatibility.reason
      })
    }
  }
  return failures
}

function commandSchemaVersion(contribution: AppPluginCommandContribution): 1 | 2 | null {
  const v2Keys = ['parameters', 'result', 'permissions'] as const
  const present = v2Keys.filter((key) => Object.hasOwn(contribution, key)).length
  if (present === 0) return 1
  return present === v2Keys.length ? 2 : null
}

function exporterSchemaVersion(contribution: AppPluginExporterContribution): 1 | 2 | null {
  const v2Keys = ['parameters', 'result', 'permissions', 'outputs'] as const
  const present = v2Keys.filter((key) => Object.hasOwn(contribution, key)).length
  if (present === 0 && Object.hasOwn(contribution, 'fileExtension')) return 1
  return present === v2Keys.length && !Object.hasOwn(contribution, 'fileExtension') ? 2 : null
}

function samePermissions(
  actual: readonly PluginHostPermissionV2[],
  expected: readonly PluginHostPermissionV2[]
): boolean {
  return (
    actual.length === expected.length &&
    expected.every((permission) => actual.includes(permission)) &&
    new Set(actual).size === actual.length
  )
}

function sameOutputs(
  actual: readonly PluginExporterOutputV2[],
  expected: readonly PluginExporterOutputV2[]
): boolean {
  return (
    actual.length === expected.length &&
    actual.every(
      (output, index) =>
        output.extension === expected[index]?.extension &&
        output.mimeType === expected[index]?.mimeType
    )
  )
}

function contributionIdentity(
  source: Readonly<PluginContributionDataRecord>,
  key: 'commandId' | 'exporterId' | 'adapterId',
  path: string
): string {
  const value = source[key]
  if (typeof value !== 'string') throw new Error(`${path}.${key} must be a string`)
  return value
}

function requireRunnable(plugin: InstalledAppPlugin): string {
  const pluginId = plugin.package.manifest.plugin.id
  if (!plugin.enabled) throw new Error(`Plugin is disabled: ${pluginId}`)
  if (plugin.blockedReason) throw new Error(plugin.blockedReason)
  return pluginId
}

function requireDeclaredCommand(
  plugin: InstalledAppPlugin,
  contribution: AppPluginCommandContribution
): AppPluginCommandContribution {
  const source = plainDataContribution(contribution, 'Plugin command contribution')
  const commandId = contributionIdentity(source, 'commandId', 'Plugin command contribution')
  const adapterId = contributionIdentity(source, 'adapterId', 'Plugin command contribution')
  const declared = plugin.package.manifest.contributions.commands?.find(
    (candidate) => candidate.commandId === commandId
  )
  if (
    !declared ||
    declared.adapterId !== adapterId ||
    (plugin.package.manifest.schemaVersion === 2 && !sameJSONAuthority(source, declared))
  ) {
    throw new Error(`Command is not declared by the installed plugin: ${commandId}`)
  }
  return declared
}

function requireDeclaredExporter(
  plugin: InstalledAppPlugin,
  contribution: AppPluginExporterContribution
): AppPluginExporterContribution {
  const source = plainDataContribution(contribution, 'Plugin exporter contribution')
  const exporterId = contributionIdentity(source, 'exporterId', 'Plugin exporter contribution')
  const adapterId = contributionIdentity(source, 'adapterId', 'Plugin exporter contribution')
  const declared = plugin.package.manifest.contributions.exporters?.find(
    (candidate) => candidate.exporterId === exporterId
  )
  if (
    !declared ||
    declared.adapterId !== adapterId ||
    (plugin.package.manifest.schemaVersion === 1 &&
      source.fileExtension !== (declared as DeclarativeExporterContributionV1).fileExtension) ||
    (plugin.package.manifest.schemaVersion === 2 && !sameJSONAuthority(source, declared))
  ) {
    throw new Error(`Exporter is not declared by the installed plugin: ${exporterId}`)
  }
  return declared
}

const EMPTY_ARGUMENT_SCHEMA: PluginObjectParameterSchemaV2 = Object.freeze({
  type: 'object',
  properties: Object.freeze({}),
  additionalProperties: false,
  maxProperties: 0
})

function contributionArguments(
  contribution: AppPluginCommandContribution | AppPluginExporterContribution,
  args: unknown
): JSONObject {
  const schemaVersion = Object.hasOwn(contribution, 'parameters') ? 2 : 1
  const value =
    schemaVersion === 2
      ? parsePluginObjectParameterValue(
          args,
          (contribution as DeclarativeCommandContributionV2).parameters.schema,
          (contribution as DeclarativeCommandContributionV2).parameters.maxBytes,
          'Plugin contribution arguments'
        )
      : parsePluginObjectParameterValue(args, EMPTY_ARGUMENT_SCHEMA, 2, 'Plugin v1 arguments')
  return value as JSONObject
}

function validatedExecutionResult(
  contribution: AppPluginCommandContribution | AppPluginExporterContribution,
  execution: AppPluginHostExecutionResult
): AppPluginHostExecutionResult {
  if (!Object.hasOwn(contribution, 'result')) return execution
  const contract = (contribution as DeclarativeCommandContributionV2).result
  const data = parsePluginObjectParameterValue(
    execution.data ?? {},
    contract.schema,
    contract.maxBytes,
    'Plugin contribution result'
  )
  return execution.data === undefined ? execution : { ...execution, data: data as JSONValue }
}

export async function runInstalledPluginCommand(
  editor: EditorStore,
  plugin: InstalledAppPlugin,
  contribution: AppPluginCommandContribution,
  executors: AppPluginHostExecutors = DEFAULT_EXECUTORS,
  args: unknown = {},
  signal?: AbortSignal
): Promise<AppPluginHostExecutionResult> {
  const pluginId = requireRunnable(plugin)
  const declared = requireDeclaredCommand(plugin, contribution)
  const compatibility = inspectPluginCommandCompatibility(pluginId, declared)
  if (!compatibility.ok) throw new Error(compatibility.reason)
  const validatedArgs = contributionArguments(declared, args)
  const execute = executors.resolveCommand?.(declared.adapterId)
  if (execute) {
    return validatedExecutionResult(declared, await execute(editor, validatedArgs, signal))
  }
  if (commandSchemaVersion(declared) === 2) {
    throw new Error(`Plugin command executor is unavailable: ${declared.adapterId}`)
  }
  return validatedExecutionResult(declared, {
    status: 'completed',
    message: await executors.clipboard(editor, declared.commandId)
  })
}

export async function runInstalledPluginExporter(
  editor: EditorStore,
  plugin: InstalledAppPlugin,
  contribution: AppPluginExporterContribution,
  executors: AppPluginHostExecutors = DEFAULT_EXECUTORS,
  signal?: AbortSignal,
  args: unknown = {}
): Promise<AppPluginHostExecutionResult> {
  throwIfPluginExportAborted(signal)
  const pluginId = requireRunnable(plugin)
  const declared = requireDeclaredExporter(plugin, contribution)
  const compatibility = inspectPluginExporterCompatibility(pluginId, declared)
  if (!compatibility.ok) throw new Error(compatibility.reason)
  const validatedArgs = contributionArguments(declared, args)
  const execute = executors.resolveExporter(declared.adapterId)
  if (!execute) {
    throw new Error(`Plugin exporter executor is unavailable: ${declared.adapterId}`)
  }
  throwIfPluginExportAborted(signal)
  const result = await runAppPluginExportSession({
    pluginId,
    exporterId: declared.exporterId,
    signal,
    operation: (sessionSignal) => execute(editor, sessionSignal, validatedArgs)
  })
  const data = createPluginExportResultData(result)
  const execution: AppPluginHostExecutionResult = result.saved
    ? {
        status: 'completed',
        message: `Exported ${result.fileCount} files to ${result.fileName}${
          result.warnings.length > 0 ? ` with ${result.warnings.length} warning(s)` : ''
        }`,
        data
      }
    : { status: 'cancelled', message: 'Export cancelled', data }
  return validatedExecutionResult(declared, execution)
}
