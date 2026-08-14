<script setup lang="ts">
/* eslint-disable max-lines -- Plugin settings coordinates lifecycle, runtime, host actions, and dependency review. */
import { computed, nextTick, ref } from 'vue'
import { AlertDialogCancel, AlertDialogDescription, AlertDialogTitle } from 'reka-ui'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'
import { useI18n, useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  addInstalledPluginModuleToCanvas,
  appPluginMarketplaceSnapshot,
  appPluginRemoteCatalogConfigured,
  appPluginRemoteCatalogSnapshot,
  appPluginRuntimeManager,
  appPluginRuntimeReady,
  appPluginRuntimeSnapshot,
  appPluginStore,
  appPluginStoreSnapshot,
  appConnectorHostAdapters,
  inspectPluginCommandCompatibility,
  inspectPluginExporterCompatibility,
  inspectPluginHostContributionsCompatibility,
  inspectConnectorManifestCompatibility,
  inspectPluginModuleContributionsCompatibility,
  inspectPluginModuleCompatibility,
  resolveAppPluginDocumentDependencies,
  runInstalledPluginCommand,
  runInstalledPluginExporter,
  supportsPluginExporterCancellation,
  uninstallAppPlugin,
  writeAppPluginDocumentLock,
  type AppPluginDocumentDependency,
  type AppPluginDocumentDependencyStatus,
  type AppPluginModuleCompatibilityStatus,
  type AppPluginRecordIssue,
  type InstalledAppPlugin,
  type InstalledPluginCommand,
  type InstalledPluginExporter,
  type InstalledPluginModule,
  type PluginRuntimePolicyRecordV1,
  type PluginRuntimeReview
} from '@/app/plugins'
import {
  localizedAppPluginContributionText,
  localizedAppPluginText
} from '@/app/plugins/localization'
import { REVIEWED_DEPLOYMENT_PLUGINS } from '@/app/plugins/host/deployment/contract'
import { AI_POPOUT_PLUGIN_ID, COMPILER_PREVIEW_POPOUT_PLUGIN_ID } from '@/app/plugins/host/ids'
import {
  clearDeploymentPluginSession,
  isDeploymentPluginSessionActive
} from '@/app/plugins/host/deployment/session'
import {
  appPluginExportSessionSnapshot,
  cancelAppPluginExport,
  type AppPluginExportStage
} from '@/app/plugins/host/export-session'
import {
  filterPluginDiscoverCatalog,
  pluginMarketplaceListingViews,
  pluginV2ContractSummaries,
  type PluginMarketplaceKeyStatus
} from '@/app/plugins/settings-view-model'
import { settingsDialogOpen } from '@/app/settings/dialog'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { AppAlertDialogRoot, AppDialogBody, AppDialogFooter } from '@/components/ui/dialog'
import AccessibilityAuditReport from './AccessibilityAuditReport.vue'
import AIPopoutControls from './AIPopoutControls.vue'
import ApplicationSecurityReadinessReport from './ApplicationSecurityReadinessReport.vue'
import CompilerPreviewPopoutControls from './CompilerPreviewPopoutControls.vue'
import PluginConnectorControls from './PluginConnectorControls.vue'
import PluginDeploymentControls from './PluginDeploymentControls.vue'
import PluginExporterResult from './PluginExporterResult.vue'
import PluginConnectorOutcomeUnknownNotices from './PluginConnectorOutcomeUnknownNotices.vue'
import PluginMarketplaceSummary from './PluginMarketplaceSummary.vue'
import PluginV2ContractSummary from './PluginV2ContractSummary.vue'

const { dialogs, locale } = useI18n()
const editor = useEditorStore()
const view = ref<'browse' | 'installed'>('browse')
const busyPluginId = ref<string | null>(null)
const operationError = ref<string | null>(null)
const pendingUninstallId = ref<string | null>(null)
const pendingPinReplacementId = ref<string | null>(null)
const pendingResetPluginId = ref<string | null>(null)
const pendingRollback = ref<{ pluginId: string; targetDigest: string } | null>(null)
const documentLockMessage = ref<string | null>(null)
const refreshingRemoteCatalog = ref(false)
const discoverQuery = ref('')
const runtimeBusyPluginId = ref<string | null>(null)
const runtimeReviews = ref<Record<string, PluginRuntimeReview | undefined>>({})
const runtimeErrors = ref<Record<string, string | undefined>>({})
const runtimeOutputs = ref<Record<string, string | undefined>>({})
const hostBusyKey = ref<string | null>(null)
const hostActionMessage = ref<string | null>(null)
const hostActionStatus = ref<'completed' | 'cancelled' | null>(null)
const hostActionData = ref<JSONValue>()
const hostActionResult = ref<HTMLElement | null>(null)

const viewOptions = computed(() => [
  { value: 'browse', label: dialogs.value.pluginsBrowse },
  { value: 'installed', label: dialogs.value.pluginsInstalled }
])
const catalog = computed(() => appPluginStoreSnapshot.value.catalog)
const installed = computed(() => appPluginStoreSnapshot.value.installed)
const marketplaceListings = computed(() =>
  pluginMarketplaceListingViews(appPluginMarketplaceSnapshot.value)
)
const discoverCatalog = computed(() =>
  filterPluginDiscoverCatalog(
    catalog.value,
    appPluginMarketplaceSnapshot.value,
    discoverQuery.value
  ).map((item) => ({
    item,
    marketplace: marketplaceListings.value.get(item.package.manifest.plugin.id) ?? null,
    contractSummaries: pluginV2ContractSummaries(item.package.manifest)
  }))
)
const installedPluginViews = computed(() =>
  installed.value.map((plugin) => {
    const id = pluginId(plugin)
    return {
      plugin,
      runtimeReview: runtimeReviews.value[id],
      runtimePolicy:
        appPluginRuntimeSnapshot.value.policies.find((policy) => policy.pluginId === id) ?? null,
      runtimeError: runtimeErrors.value[id],
      runtimeOutput: runtimeOutputs.value[id],
      contractSummaries: pluginV2ContractSummaries(plugin.package.manifest),
      pendingContractSummaries: plugin.installedState?.pending
        ? pluginV2ContractSummaries(plugin.installedState.pending.candidate.manifest)
        : []
    }
  })
)
const pendingUninstall = computed(
  () =>
    installed.value.find(
      (plugin) => plugin.package.manifest.plugin.id === pendingUninstallId.value
    ) ?? null
)
const pendingPinReplacement = computed(
  () =>
    appPluginStoreSnapshot.value.pinnedDigestMismatches.find(
      (issue) => issue.pluginId === pendingPinReplacementId.value
    ) ?? null
)
const resettableRecordIssues = computed(() =>
  appPluginStoreSnapshot.value.recordIssues.filter(
    (issue): issue is AppPluginRecordIssue & { pluginId: string } => issue.pluginId !== null
  )
)
const pendingResetIssue = computed(
  () =>
    resettableRecordIssues.value.find((issue) => issue.pluginId === pendingResetPluginId.value) ??
    null
)
const pendingRollbackPlugin = computed(() => {
  const request = pendingRollback.value
  if (!request) return null
  const plugin = installed.value.find((candidate) => pluginId(candidate) === request.pluginId)
  const target = plugin?.installedState?.history.find(
    (candidate) => candidate.verifiedDigest === request.targetDigest
  )
  return plugin && target ? { plugin, target } : null
})
const documentDependencies = useSceneComputed(() =>
  resolveAppPluginDocumentDependencies(editor.graph, installed.value)
)
const canWriteDocumentLock = computed(
  () =>
    documentDependencies.value.invalidModuleCount === 0 &&
    documentDependencies.value.dependencies.length > 0 &&
    documentDependencies.value.dependencies.every(
      (dependency) =>
        dependency.installed !== null &&
        dependency.status !== 'unsupported-module' &&
        dependency.status !== 'config-version-mismatch' &&
        dependency.status !== 'unsupported-host-adapter' &&
        dependency.status !== 'invalid-module-config'
    )
)

function pluginId(plugin: InstalledAppPlugin): string {
  return plugin.package.manifest.plugin.id
}

function pluginDisplayName(plugin: InstalledAppPlugin['package']['manifest']): string {
  return localizedAppPluginText(plugin.plugin.id, locale.value)?.name ?? plugin.plugin.name
}

function contributionDisplayName(
  pluginIdValue: string,
  contributionId: string,
  fallback: string
): string {
  return (
    localizedAppPluginContributionText(pluginIdValue, contributionId, locale.value)?.name ??
    fallback
  )
}

function trustLabel(trustSource: InstalledAppPlugin['package']['trustSource']): string {
  return trustSource === 'app-bundle'
    ? dialogs.value.pluginTrustAppBundle
    : dialogs.value.pluginTrustPublisher
}

type MarketplaceStatus =
  | 'active'
  | 'suspended'
  | 'revoked'
  | 'not-yet-valid'
  | 'expired'
  | 'unknown'

function marketplaceStatusLabel(status: MarketplaceStatus): string {
  const labels: Record<MarketplaceStatus, string> = {
    active: dialogs.value.pluginMarketplaceStatusActive,
    suspended: dialogs.value.pluginMarketplaceStatusSuspended,
    revoked: dialogs.value.pluginMarketplaceStatusRevoked,
    'not-yet-valid': dialogs.value.pluginMarketplaceStatusNotYetValid,
    expired: dialogs.value.pluginMarketplaceStatusExpired,
    unknown: dialogs.value.pluginMarketplaceStatusUnknown
  }
  return labels[status]
}

function marketplaceStatusTone(
  status: MarketplaceStatus
): 'neutral' | 'success' | 'warning' | 'error' {
  if (status === 'active') return 'success'
  if (status === 'revoked') return 'error'
  if (status === 'unknown') return 'neutral'
  return 'warning'
}

function marketplaceKeyStatusLabel(status: PluginMarketplaceKeyStatus): string {
  return marketplaceStatusLabel(status)
}

function runtimeGrantActive(
  policy: PluginRuntimePolicyRecordV1 | null,
  review: PluginRuntimeReview | undefined
): boolean {
  return Boolean(
    policy?.grantedAt &&
    !policy.revokedAt &&
    review?.executionStatus === 'eligible' &&
    policy.declarativeManifestDigest === review.declarativeManifestDigest &&
    policy.runtimePackageDigest === review.runtimePackageDigest &&
    policy.grantedCapabilities.length === review.capabilities.length &&
    policy.grantedCapabilities.every(
      (capability, index) => capability === review.capabilities[index]
    )
  )
}

async function runtimeOperation<T>(
  pluginIdValue: string,
  operation: () => Promise<T>,
  accept: (value: T) => void = () => undefined,
  reject: () => void = () => undefined
): Promise<void> {
  runtimeBusyPluginId.value = pluginIdValue
  runtimeErrors.value = { ...runtimeErrors.value, [pluginIdValue]: undefined }
  try {
    await appPluginRuntimeReady
    accept(await operation())
  } catch (error) {
    reject()
    runtimeErrors.value = {
      ...runtimeErrors.value,
      [pluginIdValue]: error instanceof Error ? error.message : String(error)
    }
  } finally {
    runtimeBusyPluginId.value = null
  }
}

function reviewRuntime(pluginIdValue: string): void {
  void runtimeOperation(
    pluginIdValue,
    () => appPluginRuntimeManager.review(pluginIdValue),
    (value) => {
      runtimeReviews.value = { ...runtimeReviews.value, [pluginIdValue]: value }
    }
  )
}

function grantRuntime(
  pluginIdValue: string,
  expectedReview: PluginRuntimeReview | undefined
): void {
  if (!expectedReview) return
  void runtimeOperation(
    pluginIdValue,
    () => appPluginRuntimeManager.grant(pluginIdValue, expectedReview),
    () => undefined,
    () => {
      runtimeReviews.value = { ...runtimeReviews.value, [pluginIdValue]: undefined }
    }
  )
}

function revokeRuntime(pluginIdValue: string): void {
  void runtimeOperation(pluginIdValue, () => appPluginRuntimeManager.revoke(pluginIdValue))
}

function runRuntime(pluginIdValue: string): void {
  runtimeOutputs.value = { ...runtimeOutputs.value, [pluginIdValue]: undefined }
  void runtimeOperation(
    pluginIdValue,
    () => appPluginRuntimeManager.execute(pluginIdValue, null),
    (value) => {
      runtimeOutputs.value = { ...runtimeOutputs.value, [pluginIdValue]: JSON.stringify(value) }
    }
  )
}

function recordIssueLabel(issue: AppPluginRecordIssue & { pluginId: string }): string {
  return issue.kind === 'unsupported-schema'
    ? dialogs.value.pluginStateUnsupportedSchema({ pluginId: issue.pluginId })
    : dialogs.value.pluginStateInvalid({ pluginId: issue.pluginId })
}

function dependencyStatusLabel(status: AppPluginDocumentDependencyStatus): string {
  const labels: Record<AppPluginDocumentDependencyStatus, string> = {
    ready: dialogs.value.pluginDocumentDependencyReady,
    'lock-missing': dialogs.value.pluginDocumentDependencyLockMissing,
    'lock-entry-missing': dialogs.value.pluginDocumentDependencyLockEntryMissing,
    'not-installed': dialogs.value.pluginDocumentDependencyNotInstalled,
    disabled: dialogs.value.pluginDocumentDependencyDisabled,
    'unsupported-module': dialogs.value.pluginDocumentDependencyUnsupportedModule,
    'config-version-mismatch': dialogs.value.pluginDocumentDependencyConfigVersionMismatch,
    'unsupported-host-adapter': dialogs.value.pluginDocumentDependencyUnsupportedHostAdapter,
    'invalid-module-config': dialogs.value.pluginDocumentDependencyInvalidModuleConfig,
    'version-mismatch': dialogs.value.pluginDocumentDependencyVersionMismatch,
    'digest-mismatch': dialogs.value.pluginDocumentDependencyDigestMismatch,
    'publisher-key-mismatch': dialogs.value.pluginDocumentDependencyPublisherKeyMismatch
  }
  return labels[status]
}

function dependencyModulesLabel(dependency: AppPluginDocumentDependency): string {
  return dependency.modules
    .map(
      (module) =>
        `${module.moduleType}@${module.configVersions.map((version) => `v${version}`).join('/')}`
    )
    .join(', ')
}

function moduleCompatibility(
  pluginIdValue: string,
  contribution: InstalledPluginModule['contribution']
) {
  return inspectPluginModuleCompatibility(pluginIdValue, contribution)
}

function moduleCompatibilityLabel(status: AppPluginModuleCompatibilityStatus): string {
  const labels: Record<AppPluginModuleCompatibilityStatus, string> = {
    compatible: dialogs.value.pluginAdapterCompatible,
    'untrusted-adapter': dialogs.value.pluginAdapterUntrusted,
    'plugin-identity-mismatch': dialogs.value.pluginAdapterPluginIdentityMismatch,
    'module-identity-mismatch': dialogs.value.pluginAdapterModuleIdentityMismatch,
    'host-adapter-unavailable': dialogs.value.pluginAdapterUnavailable,
    'config-version-mismatch': dialogs.value.pluginAdapterConfigVersionMismatch,
    'invalid-default-config': dialogs.value.pluginAdapterInvalidDefaultConfig
  }
  return labels[status]
}

function hasCompatibleModules(
  pluginIdValue: string,
  contributions: readonly InstalledPluginModule['contribution'][]
): boolean {
  return inspectPluginModuleContributionsCompatibility(pluginIdValue, contributions).length === 0
}

function manifestDescription(plugin: InstalledAppPlugin['package']['manifest']): string {
  const localized = localizedAppPluginText(plugin.plugin.id, locale.value)
  if (localized) return localized.description
  return (
    plugin.contributions.modules[0]?.description ??
    plugin.contributions.commands?.[0]?.description ??
    plugin.contributions.exporters?.[0]?.description ??
    (plugin.schemaVersion === 2 ? plugin.contributions.connectors?.[0]?.description : undefined) ??
    ''
  )
}

function hasCompatibleContributions(manifest: InstalledAppPlugin['package']['manifest']): boolean {
  const pluginIdValue = manifest.plugin.id
  const contributions = manifest.contributions
  return (
    hasCompatibleModules(pluginIdValue, contributions.modules) &&
    inspectPluginHostContributionsCompatibility(pluginIdValue, contributions).length === 0 &&
    inspectConnectorManifestCompatibility(manifest, appConnectorHostAdapters).ok
  )
}

function connectorCompatibilityReason(manifest: InstalledAppPlugin['package']['manifest']): string {
  const compatibility = inspectConnectorManifestCompatibility(manifest, appConnectorHostAdapters)
  return compatibility.ok ? '' : compatibility.reason
}

function commandCompatibility(
  pluginIdValue: string,
  contribution: InstalledPluginCommand['contribution']
) {
  return inspectPluginCommandCompatibility(pluginIdValue, contribution)
}

function visibleCommands(plugin: InstalledAppPlugin) {
  const deployment = REVIEWED_DEPLOYMENT_PLUGINS.find(
    (definition) => definition.pluginId === pluginId(plugin)
  )
  return (plugin.package.manifest.contributions.commands ?? []).filter(
    (contribution) => contribution.commandId !== deployment?.mcpSafePlan.commandId
  )
}

function exporterCompatibility(
  pluginIdValue: string,
  contribution: InstalledPluginExporter['contribution']
) {
  return inspectPluginExporterCompatibility(pluginIdValue, contribution)
}

function hostCompatibilityReason(
  compatibility: ReturnType<
    typeof inspectPluginCommandCompatibility | typeof inspectPluginExporterCompatibility
  >
): string {
  return compatibility.ok ? '' : compatibility.reason
}

function hostContributionKey(
  plugin: InstalledAppPlugin,
  kind: 'command' | 'exporter',
  contributionId: string
): string {
  return `${pluginId(plugin)}:${kind}:${contributionId}`
}

function pendingUpdateCompatibilityFailures(plugin: InstalledAppPlugin) {
  const pending = plugin.installedState?.pending
  if (!pending) return []
  const manifest = pending.candidate.manifest
  const contributions = manifest.contributions
  const connectorCompatibility = inspectConnectorManifestCompatibility(
    manifest,
    appConnectorHostAdapters
  )
  return [
    ...inspectPluginModuleContributionsCompatibility(pluginId(plugin), contributions.modules).map(
      (failure) => ({ id: failure.moduleType, status: failure.status, reason: failure.reason })
    ),
    ...inspectPluginHostContributionsCompatibility(pluginId(plugin), contributions).map(
      (failure) => ({
        id: `${failure.kind}:${failure.contributionId}`,
        status: failure.status,
        reason: failure.reason
      })
    ),
    ...(connectorCompatibility.ok
      ? []
      : [
          {
            id: 'connector',
            status: 'connector-incompatible',
            reason: connectorCompatibility.reason
          }
        ])
  ]
}

function documentLockLabel(): string {
  if (documentDependencies.value.lock.status === 'valid') {
    return dialogs.value.pluginDocumentLockValid
  }
  if (documentDependencies.value.lock.status === 'invalid') {
    return dialogs.value.pluginDocumentLockInvalid
  }
  return dialogs.value.pluginDocumentLockAbsent
}

function remoteCatalogStatusLabel(): string {
  if (!appPluginRemoteCatalogConfigured) return dialogs.value.pluginRemoteNotConfigured
  const status = appPluginRemoteCatalogSnapshot.value?.status
  if (!status) return dialogs.value.pluginLoading
  const labels = {
    fresh: dialogs.value.pluginRemoteFresh,
    cached: dialogs.value.pluginRemoteCached,
    stale: dialogs.value.pluginRemoteStale,
    unavailable: dialogs.value.pluginRemoteUnavailable
  }
  return labels[status]
}

function remoteCatalogStatusTone(): 'neutral' | 'success' | 'warning' | 'error' {
  if (!appPluginRemoteCatalogConfigured || !appPluginRemoteCatalogSnapshot.value) return 'neutral'
  const status = appPluginRemoteCatalogSnapshot.value.status
  if (status === 'fresh') return 'success'
  if (status === 'cached') return 'neutral'
  return status === 'stale' ? 'warning' : 'error'
}

async function refreshRemoteCatalog(): Promise<void> {
  if (!appPluginRemoteCatalogConfigured || refreshingRemoteCatalog.value) return
  refreshingRemoteCatalog.value = true
  operationError.value = null
  try {
    await appPluginStore.refreshCatalog()
  } catch (error) {
    operationError.value = dialogs.value.pluginOperationFailed({
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    refreshingRemoteCatalog.value = false
  }
}

async function mutate(pluginIdValue: string, operation: () => Promise<unknown>): Promise<void> {
  busyPluginId.value = pluginIdValue
  operationError.value = null
  try {
    await operation()
  } catch (error) {
    operationError.value = dialogs.value.pluginOperationFailed({
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    busyPluginId.value = null
  }
}

function rejectActiveDeployment(pluginIdValue: string): boolean {
  if (!isDeploymentPluginSessionActive(pluginIdValue)) return false
  operationError.value =
    locale.value === 'zh-CN'
      ? '此插件仍在部署。请等待远程操作完成后再禁用、更新、回滚或卸载。'
      : 'This plugin is still deploying. Wait for the remote operation to finish before disabling, updating, rolling back, or uninstalling it.'
  return true
}

function isPluginExportActive(pluginIdValue: string): boolean {
  return appPluginExportSessionSnapshot.value?.pluginId === pluginIdValue
}

function rejectActiveExport(pluginIdValue: string): boolean {
  if (!isPluginExportActive(pluginIdValue)) return false
  operationError.value = dialogs.value.pluginExportLifecycleBlocked
  return true
}

function rejectActivePluginOperation(pluginIdValue: string): boolean {
  return rejectActiveDeployment(pluginIdValue) || rejectActiveExport(pluginIdValue)
}

function pluginExportStageLabel(stage: AppPluginExportStage): string {
  const labels: Record<AppPluginExportStage, string> = {
    'choosing-destination': dialogs.value.pluginExportChoosingDestination,
    preparing: dialogs.value.pluginExportPreparing,
    compiling: dialogs.value.pluginExportCompiling,
    archiving: dialogs.value.pluginExportArchiving,
    saving: dialogs.value.pluginExportSaving,
    cancelling: dialogs.value.pluginExportCancelling
  }
  return labels[stage]
}

function pluginExporterStageLabel(pluginIdValue: string, exporterId: string): string | null {
  const session = appPluginExportSessionSnapshot.value
  return session?.pluginId === pluginIdValue && session.exporterId === exporterId
    ? pluginExportStageLabel(session.stage)
    : null
}

function pluginDisabledExplanation(plugin: InstalledAppPlugin): string {
  return plugin.package.manifest.contributions.modules.length > 0
    ? dialogs.value.pluginDisabledHint
    : dialogs.value.pluginDisabledContributionHint
}

function install(pluginIdValue: string): void {
  if (
    appPluginStoreSnapshot.value.pinnedDigestMismatches.some(
      (issue) => issue.pluginId === pluginIdValue
    )
  ) {
    pendingPinReplacementId.value = pluginIdValue
    return
  }
  void mutate(pluginIdValue, async () => {
    await appPluginStore.install(pluginIdValue)
    view.value = 'installed'
  })
}

function retryLoad(): void {
  operationError.value = null
  void appPluginStore.load()
}

function setEnabled(plugin: InstalledAppPlugin, enabled: boolean): void {
  if (!enabled && rejectActivePluginOperation(pluginId(plugin))) return
  void mutate(pluginId(plugin), () => appPluginStore.setEnabled(pluginId(plugin), enabled))
}

function setPinned(plugin: InstalledAppPlugin): void {
  void mutate(pluginId(plugin), () =>
    appPluginStore.setPinned(pluginId(plugin), plugin.pinnedDigest === null)
  )
}

function acceptUpdate(plugin: InstalledAppPlugin): void {
  if (
    pendingUpdateCompatibilityFailures(plugin).length > 0 ||
    rejectActivePluginOperation(pluginId(plugin))
  ) {
    return
  }
  void mutate(pluginId(plugin), () => appPluginStore.acceptUpdate(pluginId(plugin)))
}

function rejectUpdate(plugin: InstalledAppPlugin): void {
  void mutate(pluginId(plugin), () => appPluginStore.rejectUpdate(pluginId(plugin)))
}

function requestRollback(plugin: InstalledAppPlugin): void {
  if (rejectActivePluginOperation(pluginId(plugin))) return
  const target = plugin.installedState?.history[0]
  if (!target) return
  pendingRollback.value = {
    pluginId: pluginId(plugin),
    targetDigest: target.verifiedDigest
  }
}

function confirmRollback(): void {
  const request = pendingRollback.value
  if (!request) return
  if (rejectActivePluginOperation(request.pluginId)) {
    pendingRollback.value = null
    return
  }
  pendingRollback.value = null
  void mutate(request.pluginId, () =>
    appPluginStore.rollback(request.pluginId, request.targetDigest)
  )
}

function writeDocumentLock(): void {
  operationError.value = null
  documentLockMessage.value = null
  try {
    writeAppPluginDocumentLock(editor.graph, installed.value)
    editor.requestRender()
    documentLockMessage.value = dialogs.value.pluginDocumentWriteLockSuccess
  } catch (error) {
    operationError.value = dialogs.value.pluginOperationFailed({
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

function addModule(
  plugin: InstalledAppPlugin,
  contribution: InstalledPluginModule['contribution']
): void {
  operationError.value = null
  try {
    const module = appPluginStore.module(pluginId(plugin), contribution.moduleType)
    if (!module) throw new Error(dialogs.value.pluginDisabledHint)
    addInstalledPluginModuleToCanvas(editor, module)
    settingsDialogOpen.value = false
  } catch (error) {
    operationError.value = dialogs.value.pluginOperationFailed({
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function runHostContribution(
  key: string,
  operation: () => Promise<{
    status: 'completed' | 'cancelled'
    message: string
    data?: JSONValue
  }>,
  cancelledMessage?: string
): Promise<void> {
  hostBusyKey.value = key
  hostActionMessage.value = null
  hostActionStatus.value = null
  hostActionData.value = undefined
  operationError.value = null
  try {
    const result = await operation()
    hostActionMessage.value = result.message
    hostActionStatus.value = result.status
    hostActionData.value = result.data
  } catch (error) {
    if (cancelledMessage !== undefined && error instanceof Error && error.name === 'AbortError') {
      hostActionMessage.value = cancelledMessage
      hostActionStatus.value = 'cancelled'
    } else {
      operationError.value = dialogs.value.pluginOperationFailed({
        error: error instanceof Error ? error.message : String(error)
      })
    }
  } finally {
    hostBusyKey.value = null
    await nextTick()
    hostActionResult.value?.focus({ preventScroll: true })
    hostActionResult.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

function runCommand(
  plugin: InstalledAppPlugin,
  contribution: InstalledPluginCommand['contribution']
): void {
  const key = hostContributionKey(plugin, 'command', contribution.commandId)
  void runHostContribution(key, () => runInstalledPluginCommand(editor, plugin, contribution))
}

function runExporter(
  plugin: InstalledAppPlugin,
  contribution: InstalledPluginExporter['contribution']
): void {
  const key = hostContributionKey(plugin, 'exporter', contribution.exporterId)
  void runHostContribution(
    key,
    () => runInstalledPluginExporter(editor, plugin, contribution),
    dialogs.value.pluginExportCancelled
  )
}

function withoutPluginRuntimeValue<Value>(
  values: Record<string, Value | undefined>,
  pluginIdValue: string
): Record<string, Value | undefined> {
  const { [pluginIdValue]: _removed, ...remaining } = values
  return remaining
}

function clearPluginRuntimeUI(pluginIdValue: string): void {
  runtimeReviews.value = withoutPluginRuntimeValue(runtimeReviews.value, pluginIdValue)
  runtimeOutputs.value = withoutPluginRuntimeValue(runtimeOutputs.value, pluginIdValue)
  runtimeErrors.value = withoutPluginRuntimeValue(runtimeErrors.value, pluginIdValue)
}

function confirmUninstall(): void {
  const plugin = pendingUninstall.value
  if (!plugin) return
  const id = pluginId(plugin)
  if (rejectActivePluginOperation(id)) {
    pendingUninstallId.value = null
    return
  }
  pendingUninstallId.value = null
  void mutate(id, async () => {
    await uninstallAppPlugin(id)
    clearDeploymentPluginSession(id)
    clearPluginRuntimeUI(id)
  })
}

function confirmPinReplacement(): void {
  const issue = pendingPinReplacement.value
  if (!issue) return
  pendingPinReplacementId.value = null
  void mutate(issue.pluginId, () =>
    appPluginStore.replacePinnedDigest(issue.pluginId, issue.previousDigest)
  )
}

function confirmResetLocalState(): void {
  const issue = pendingResetIssue.value
  if (!issue) return
  if (rejectActivePluginOperation(issue.pluginId)) {
    pendingResetPluginId.value = null
    return
  }
  pendingResetPluginId.value = null
  void mutate(issue.pluginId, () => appPluginStore.resetLocalState(issue.pluginId))
}
</script>

<template>
  <section class="flex flex-col gap-3" data-test-id="settings-plugins-panel">
    <div>
      <h3 class="text-xs font-semibold text-surface">{{ dialogs.settingsPlugins }}</h3>
      <p class="mt-0.5 text-[10px] text-muted">{{ dialogs.pluginsDescription }}</p>
    </div>

    <div class="rounded border border-border bg-panel-field px-2.5 py-2 text-[10px] text-muted">
      {{ dialogs.pluginBundleOnlyNotice }}
    </div>

    <PluginConnectorOutcomeUnknownNotices />

    <div
      class="rounded border border-border bg-panel-field px-2.5 py-2"
      data-test-id="plugin-remote-catalog"
    >
      <div class="flex items-center gap-2">
        <p class="min-w-0 flex-1 text-[10px] font-medium text-surface">
          {{ dialogs.pluginRemoteCatalog }}
        </p>
        <AppBadge :tone="remoteCatalogStatusTone()" data-test-id="plugin-remote-catalog-status">
          {{ remoteCatalogStatusLabel() }}
        </AppBadge>
        <button
          type="button"
          class="rounded border border-border px-2 py-1 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
          :disabled="!appPluginRemoteCatalogConfigured || refreshingRemoteCatalog"
          data-test-id="plugin-remote-catalog-refresh"
          @click="refreshRemoteCatalog"
        >
          {{ dialogs.refresh }}
        </button>
      </div>
      <p v-if="appPluginRemoteCatalogSnapshot?.issues.length" class="mt-1 text-[9px] text-warning">
        {{ dialogs.pluginRemoteIssues({ count: appPluginRemoteCatalogSnapshot.issues.length }) }}
      </p>
      <p
        v-if="appPluginRemoteCatalogSnapshot?.refreshError"
        class="mt-1 break-words text-[9px] text-error"
        role="alert"
      >
        {{ appPluginRemoteCatalogSnapshot.refreshError.message }}
      </p>
    </div>

    <PluginMarketplaceSummary />

    <SegmentedControl
      v-model="view"
      :options="viewOptions"
      :label="dialogs.settingsPlugins"
      data-test-id="settings-plugins-view"
    />

    <p v-if="!appPluginStoreSnapshot.ready" class="py-6 text-center text-[10px] text-muted">
      {{ dialogs.pluginLoading }}
    </p>

    <div
      v-if="appPluginStoreSnapshot.ready && appPluginStoreSnapshot.error"
      class="flex flex-col gap-2 rounded border border-warning/30 bg-warning/5 px-2.5 py-2 text-[10px] text-muted"
      role="alert"
      data-test-id="settings-plugins-load-error"
    >
      <div class="flex items-start gap-2">
        <p class="min-w-0 flex-1">{{ appPluginStoreSnapshot.error.message }}</p>
        <button
          type="button"
          class="shrink-0 rounded border border-border px-2 py-1 text-[10px] text-surface hover:bg-hover"
          data-test-id="settings-plugins-retry"
          @click="retryLoad"
        >
          {{ dialogs.pluginRetry }}
        </button>
      </div>
      <div
        v-for="issue in resettableRecordIssues"
        :key="issue.pluginId"
        class="flex items-center gap-2 border-t border-warning/20 pt-2"
      >
        <p class="min-w-0 flex-1">{{ recordIssueLabel(issue) }}</p>
        <button
          type="button"
          class="shrink-0 rounded border border-danger/40 px-2 py-1 text-[10px] text-danger hover:bg-danger/10"
          :data-test-id="`plugin-reset-local-state-${issue.pluginId}`"
          @click="pendingResetPluginId = issue.pluginId"
        >
          {{ dialogs.pluginResetLocalState }}
        </button>
      </div>
    </div>

    <template v-if="appPluginStoreSnapshot.ready && view === 'browse'">
      <label class="relative block">
        <span class="sr-only">{{ dialogs.pluginDiscoverSearch }}</span>
        <icon-lucide-search
          class="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted"
        />
        <input
          v-model="discoverQuery"
          type="search"
          maxlength="256"
          class="h-8 w-full rounded border border-border bg-panel-field pl-7 pr-2 text-[10px] text-surface outline-none placeholder:text-muted focus:border-accent"
          :placeholder="dialogs.pluginDiscoverSearchPlaceholder"
          data-test-id="plugin-discover-search"
        />
      </label>

      <div v-if="discoverCatalog.length" class="flex flex-col gap-2">
        <article
          v-for="{ item, marketplace, contractSummaries } in discoverCatalog"
          :key="item.package.manifest.plugin.id"
          class="rounded border border-border bg-panel-field p-3"
          :data-plugin-id="item.package.manifest.plugin.id"
          :data-test-id="`plugin-catalog-${item.package.manifest.plugin.id}`"
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <h4 class="text-[11px] font-medium text-surface">
                  {{ pluginDisplayName(item.package.manifest) }}
                </h4>
                <AppBadge :tone="item.installed ? 'success' : 'neutral'">
                  {{
                    item.installed ? dialogs.pluginInstalled : trustLabel(item.package.trustSource)
                  }}
                </AppBadge>
              </div>
              <p class="mt-1 text-[10px] text-muted">
                {{ marketplace?.listing.summary ?? manifestDescription(item.package.manifest) }}
              </p>
              <p class="mt-1 text-[9px] text-muted">
                {{ dialogs.pluginVersion({ version: item.package.manifest.plugin.version }) }} ·
                {{ trustLabel(item.package.trustSource) }}
              </p>
              <PluginV2ContractSummary
                v-if="contractSummaries.length"
                class="mt-2"
                :contracts="contractSummaries"
                :version-label="
                  dialogs.pluginVersion({ version: item.package.manifest.plugin.version })
                "
                scope="catalog"
              />
              <div
                v-if="marketplace"
                class="mt-2 rounded border border-border/70 px-2 py-1.5 text-[9px] text-muted"
                :data-test-id="`plugin-marketplace-listing-${item.package.manifest.plugin.id}`"
              >
                <div class="flex flex-wrap items-center gap-1">
                  <span>{{ dialogs.pluginMarketplaceChannels }}</span>
                  <AppBadge v-for="channel in marketplace.channels" :key="channel" tone="neutral">
                    {{ channel }}
                  </AppBadge>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-1">
                  <span>
                    {{
                      dialogs.pluginMarketplacePublisher({
                        publisher: marketplace.publisherName
                      })
                    }}
                  </span>
                  <AppBadge :tone="marketplaceStatusTone(marketplace.publisherStatus)">
                    {{ marketplaceStatusLabel(marketplace.publisherStatus) }}
                  </AppBadge>
                  <span>{{ dialogs.pluginMarketplaceOwnership }}</span>
                  <AppBadge :tone="marketplaceStatusTone(marketplace.ownershipStatus)">
                    {{ marketplaceStatusLabel(marketplace.ownershipStatus) }}
                  </AppBadge>
                  <span>{{ dialogs.pluginMarketplaceKey }}</span>
                  <AppBadge :tone="marketplaceStatusTone(marketplace.keyStatus)">
                    {{ marketplaceKeyStatusLabel(marketplace.keyStatus) }}
                  </AppBadge>
                </div>
                <p v-if="marketplace.listing.categories.length" class="mt-1">
                  {{ marketplace.listing.categories.join(' · ') }}
                </p>
              </div>
              <template
                v-for="contribution in item.package.manifest.contributions.modules"
                :key="contribution.moduleType"
              >
                <p
                  v-if="!moduleCompatibility(item.package.manifest.plugin.id, contribution).ok"
                  class="mt-1 text-[9px] text-error"
                  :data-test-id="`plugin-adapter-compatibility-${item.package.manifest.plugin.id}-${contribution.moduleType}`"
                >
                  {{
                    contributionDisplayName(
                      item.package.manifest.plugin.id,
                      contribution.moduleType,
                      contribution.name
                    )
                  }}
                  ·
                  {{
                    moduleCompatibilityLabel(
                      moduleCompatibility(item.package.manifest.plugin.id, contribution).status
                    )
                  }}
                </p>
              </template>
              <p
                v-for="failure in inspectPluginHostContributionsCompatibility(
                  item.package.manifest.plugin.id,
                  item.package.manifest.contributions
                )"
                :key="`${failure.kind}:${failure.contributionId}:${failure.status}`"
                class="mt-1 text-[9px] text-error"
                :data-test-id="`plugin-host-compatibility-${item.package.manifest.plugin.id}-${failure.kind}-${failure.contributionId}`"
              >
                {{ failure.contributionId }} · {{ failure.reason }}
              </p>
              <p
                v-if="connectorCompatibilityReason(item.package.manifest)"
                class="mt-1 text-[9px] text-error"
                :data-test-id="`plugin-connector-compatibility-${item.package.manifest.plugin.id}`"
              >
                {{ connectorCompatibilityReason(item.package.manifest) }}
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded bg-accent px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50"
              :disabled="
                item.installed ||
                busyPluginId === item.package.manifest.plugin.id ||
                !hasCompatibleContributions(item.package.manifest)
              "
              :data-test-id="`plugin-install-${item.package.manifest.plugin.id}`"
              @click="install(item.package.manifest.plugin.id)"
            >
              {{
                item.installed
                  ? dialogs.pluginInstalled
                  : appPluginStoreSnapshot.pinnedDigestMismatches.some(
                        (issue) => issue.pluginId === item.package.manifest.plugin.id
                      )
                    ? dialogs.pluginReplacePin
                    : hasCompatibleContributions(item.package.manifest)
                      ? dialogs.pluginInstall
                      : dialogs.pluginNoCompatibleContributions
              }}
            </button>
          </div>
        </article>
      </div>
      <p
        v-else
        class="rounded border border-dashed border-border p-4 text-center text-[10px] text-muted"
      >
        {{ discoverQuery.trim() ? dialogs.pluginsEmptySearch : dialogs.pluginsEmptyBrowse }}
      </p>
    </template>

    <template v-else-if="appPluginStoreSnapshot.ready">
      <div v-if="installedPluginViews.length" class="flex flex-col gap-2">
        <article
          v-for="{
            plugin,
            runtimeReview,
            runtimePolicy,
            runtimeError,
            runtimeOutput,
            contractSummaries,
            pendingContractSummaries
          } in installedPluginViews"
          :key="pluginId(plugin)"
          class="rounded border border-border bg-panel-field p-3"
          :data-plugin-id="pluginId(plugin)"
          :data-test-id="`plugin-installed-${pluginId(plugin)}`"
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <h4 class="text-[11px] font-medium text-surface">
                  {{ pluginDisplayName(plugin.package.manifest) }}
                </h4>
                <AppBadge :tone="plugin.enabled ? 'success' : 'neutral'">
                  {{ plugin.enabled ? dialogs.enabled : dialogs.disabled }}
                </AppBadge>
                <AppBadge v-if="plugin.pinnedDigest" tone="warning">
                  {{ dialogs.pluginPinned }}
                </AppBadge>
                <AppBadge v-if="plugin.installedState?.pending" tone="warning">
                  {{ dialogs.pluginUpdateAvailable }}
                </AppBadge>
                <AppBadge v-if="plugin.blockedReason" tone="error">
                  {{ dialogs.pluginBlocked }}
                </AppBadge>
              </div>
              <p class="mt-1 text-[10px] text-muted">
                {{ manifestDescription(plugin.package.manifest) }}
              </p>
              <div class="mt-1 text-[9px] text-muted">
                <p>
                  {{ dialogs.pluginVersion({ version: plugin.package.manifest.plugin.version }) }} ·
                  {{ trustLabel(plugin.package.trustSource) }}
                </p>
                <p class="break-all">
                  {{ dialogs.pluginDigest({ digest: plugin.package.digest }) }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[9px] text-muted">
                {{ plugin.enabled ? dialogs.enabled : dialogs.disabled }}
              </span>
              <AppSwitch
                :model-value="plugin.enabled"
                :label="plugin.enabled ? dialogs.disable : dialogs.enable"
                :disabled="
                  Boolean(plugin.blockedReason) ||
                  busyPluginId === pluginId(plugin) ||
                  isDeploymentPluginSessionActive(pluginId(plugin)) ||
                  isPluginExportActive(pluginId(plugin))
                "
                :data-test-id="`plugin-enabled-${pluginId(plugin)}`"
                @update:model-value="setEnabled(plugin, $event)"
              />
            </div>
          </div>

          <PluginV2ContractSummary
            v-if="contractSummaries.length"
            class="mt-2"
            :contracts="contractSummaries"
            :version-label="
              dialogs.pluginVersion({ version: plugin.package.manifest.plugin.version })
            "
            scope="current"
          />

          <p v-if="!plugin.enabled" class="mt-2 text-[9px] text-muted">
            {{ pluginDisabledExplanation(plugin) }}
          </p>

          <p
            v-if="plugin.blockedReason"
            class="mt-2 rounded border border-error/30 bg-error/5 px-2 py-1.5 text-[9px] text-error"
            role="alert"
          >
            {{ dialogs.pluginBlockedReason({ reason: plugin.blockedReason }) }}
          </p>

          <PluginConnectorControls :plugin="plugin" />
          <PluginDeploymentControls :plugin="plugin" />
          <CompilerPreviewPopoutControls
            v-if="pluginId(plugin) === COMPILER_PREVIEW_POPOUT_PLUGIN_ID"
            :disabled="
              !plugin.enabled ||
              Boolean(plugin.blockedReason) ||
              busyPluginId === COMPILER_PREVIEW_POPOUT_PLUGIN_ID
            "
          />
          <AIPopoutControls
            v-if="pluginId(plugin) === AI_POPOUT_PLUGIN_ID"
            :disabled="
              !plugin.enabled ||
              Boolean(plugin.blockedReason) ||
              busyPluginId === AI_POPOUT_PLUGIN_ID
            "
          />

          <div
            v-if="plugin.installedState?.pending"
            class="mt-3 rounded border border-warning/30 bg-warning/5 p-2.5"
            :data-test-id="`plugin-update-review-${pluginId(plugin)}`"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-[10px] font-medium text-surface">
                {{ dialogs.pluginUpdateAvailable }}
              </p>
              <span class="text-[9px] text-muted">
                {{ plugin.installedState.pending.diff.fromVersion ?? '—' }} →
                {{ plugin.installedState.pending.diff.toVersion }}
              </span>
            </div>
            <p
              v-if="
                plugin.installedState.accepted.verifiedKeyId !==
                plugin.installedState.pending.candidate.verifiedKeyId
              "
              class="mt-1 break-all text-[9px] text-muted"
            >
              {{
                dialogs.pluginUpdateSigningKey({
                  from: plugin.installedState.accepted.verifiedKeyId,
                  to: plugin.installedState.pending.candidate.verifiedKeyId
                })
              }}
            </p>
            <div class="mt-2 flex flex-wrap gap-1 font-mono text-[9px]">
              <span
                v-for="moduleType in plugin.installedState.pending.diff.addedModules"
                :key="`added:${moduleType}`"
                class="rounded bg-success/10 px-1.5 py-0.5 text-success"
              >
                + {{ moduleType }}
              </span>
              <span
                v-for="moduleType in plugin.installedState.pending.diff.removedModules"
                :key="`removed:${moduleType}`"
                class="rounded bg-error/10 px-1.5 py-0.5 text-error"
              >
                − {{ moduleType }}
              </span>
              <span
                v-for="moduleType in plugin.installedState.pending.diff.updatedModules"
                :key="`updated:${moduleType}`"
                class="rounded bg-accent/10 px-1.5 py-0.5 text-accent"
              >
                ~ {{ moduleType }}
              </span>
              <span
                v-for="commandId in plugin.installedState.pending.diff.addedCommands"
                :key="`added-command:${commandId}`"
                class="rounded bg-success/10 px-1.5 py-0.5 text-success"
              >
                + command:{{ commandId }}
              </span>
              <span
                v-for="commandId in plugin.installedState.pending.diff.removedCommands"
                :key="`removed-command:${commandId}`"
                class="rounded bg-error/10 px-1.5 py-0.5 text-error"
              >
                − command:{{ commandId }}
              </span>
              <span
                v-for="commandId in plugin.installedState.pending.diff.updatedCommands"
                :key="`updated-command:${commandId}`"
                class="rounded bg-accent/10 px-1.5 py-0.5 text-accent"
              >
                ~ command:{{ commandId }}
              </span>
              <span
                v-for="exporterId in plugin.installedState.pending.diff.addedExporters"
                :key="`added-exporter:${exporterId}`"
                class="rounded bg-success/10 px-1.5 py-0.5 text-success"
              >
                + exporter:{{ exporterId }}
              </span>
              <span
                v-for="exporterId in plugin.installedState.pending.diff.removedExporters"
                :key="`removed-exporter:${exporterId}`"
                class="rounded bg-error/10 px-1.5 py-0.5 text-error"
              >
                − exporter:{{ exporterId }}
              </span>
              <span
                v-for="exporterId in plugin.installedState.pending.diff.updatedExporters"
                :key="`updated-exporter:${exporterId}`"
                class="rounded bg-accent/10 px-1.5 py-0.5 text-accent"
              >
                ~ exporter:{{ exporterId }}
              </span>
              <span
                v-for="connectorId in plugin.installedState.pending.diff.addedConnectors"
                :key="`added-connector:${connectorId}`"
                class="rounded bg-success/10 px-1.5 py-0.5 text-success"
              >
                + connector:{{ connectorId }}
              </span>
              <span
                v-for="connectorId in plugin.installedState.pending.diff.removedConnectors"
                :key="`removed-connector:${connectorId}`"
                class="rounded bg-error/10 px-1.5 py-0.5 text-error"
              >
                − connector:{{ connectorId }}
              </span>
              <span
                v-for="connectorId in plugin.installedState.pending.diff.updatedConnectors"
                :key="`updated-connector:${connectorId}`"
                class="rounded bg-accent/10 px-1.5 py-0.5 text-accent"
              >
                ~ connector:{{ connectorId }}
              </span>
              <span
                v-for="providerId in plugin.installedState.pending.diff.addedStorageProviders"
                :key="`added-storage-provider:${providerId}`"
                class="rounded bg-success/10 px-1.5 py-0.5 text-success"
              >
                + storage-provider:{{ providerId }}
              </span>
              <span
                v-for="providerId in plugin.installedState.pending.diff.removedStorageProviders"
                :key="`removed-storage-provider:${providerId}`"
                class="rounded bg-error/10 px-1.5 py-0.5 text-error"
              >
                − storage-provider:{{ providerId }}
              </span>
              <span
                v-for="providerId in plugin.installedState.pending.diff.updatedStorageProviders"
                :key="`updated-storage-provider:${providerId}`"
                class="rounded bg-accent/10 px-1.5 py-0.5 text-accent"
              >
                ~ storage-provider:{{ providerId }}
              </span>
            </div>
            <p class="mt-1 break-all text-[9px] text-muted">
              {{
                dialogs.pluginDigest({
                  digest: plugin.installedState.pending.candidate.verifiedDigest
                })
              }}
            </p>
            <div class="mt-2 grid gap-2 sm:grid-cols-2">
              <PluginV2ContractSummary
                :contracts="contractSummaries"
                :version-label="
                  dialogs.pluginVersion({
                    version: plugin.installedState.accepted.manifest.plugin.version
                  })
                "
                scope="current"
              />
              <PluginV2ContractSummary
                :contracts="pendingContractSummaries"
                :version-label="
                  dialogs.pluginVersion({
                    version: plugin.installedState.pending.candidate.manifest.plugin.version
                  })
                "
                scope="pending"
              />
            </div>
            <div
              v-if="pendingUpdateCompatibilityFailures(plugin).length > 0"
              class="mt-2 rounded border border-error/30 bg-error/5 px-2 py-1.5 text-[9px] text-error"
              role="alert"
              :data-test-id="`plugin-update-compatibility-${pluginId(plugin)}`"
            >
              <p
                v-for="failure in pendingUpdateCompatibilityFailures(plugin)"
                :key="`${failure.id}:${failure.status}`"
              >
                {{ failure.id }}: {{ failure.reason }}
              </p>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                class="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50"
                :disabled="
                  Boolean(plugin.pinnedDigest) ||
                  busyPluginId === pluginId(plugin) ||
                  isDeploymentPluginSessionActive(pluginId(plugin)) ||
                  isPluginExportActive(pluginId(plugin)) ||
                  pendingUpdateCompatibilityFailures(plugin).length > 0
                "
                :data-test-id="`plugin-update-accept-${pluginId(plugin)}`"
                @click="acceptUpdate(plugin)"
              >
                {{ dialogs.pluginAcceptUpdate }}
              </button>
              <button
                type="button"
                class="rounded border border-border px-2 py-1 text-[10px] text-muted hover:bg-hover disabled:opacity-50"
                :disabled="busyPluginId === pluginId(plugin)"
                :data-test-id="`plugin-update-reject-${pluginId(plugin)}`"
                @click="rejectUpdate(plugin)"
              >
                {{ dialogs.pluginRejectUpdate }}
              </button>
            </div>
          </div>

          <section
            v-if="plugin.package.trustSource === 'publisher-signature'"
            class="mt-3 rounded border border-border/70 bg-panel px-2.5 py-2"
            :data-test-id="`plugin-runtime-${pluginId(plugin)}`"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="text-[10px] font-medium text-surface">
                  {{ dialogs.pluginRuntime }}
                </p>
                <p class="mt-0.5 text-[9px] text-muted">
                  {{ dialogs.pluginRuntimeDescription }}
                </p>
              </div>
              <AppBadge
                :tone="
                  runtimeReview?.executionStatus === 'eligible'
                    ? runtimeGrantActive(runtimePolicy, runtimeReview)
                      ? 'success'
                      : 'warning'
                    : runtimeReview
                      ? 'error'
                      : 'neutral'
                "
                :data-test-id="`plugin-runtime-status-${pluginId(plugin)}`"
              >
                {{
                  runtimeReview
                    ? runtimeReview.executionStatus === 'eligible'
                      ? runtimeGrantActive(runtimePolicy, runtimeReview)
                        ? dialogs.pluginRuntimeGranted
                        : dialogs.pluginRuntimeEligible
                      : dialogs.pluginRuntimeUnavailable
                    : dialogs.pluginRuntimeReviewRequired
                }}
              </AppBadge>
            </div>

            <div v-if="runtimeReview" class="mt-2 text-[9px] text-muted">
              <p>
                {{ dialogs.pluginRuntimeKind({ kind: runtimeReview.kind }) }} ·
                {{
                  runtimeReview.capabilities.length
                    ? dialogs.pluginRuntimeCapabilities({
                        capabilities: runtimeReview.capabilities.join(', ')
                      })
                    : dialogs.pluginRuntimeNoCapabilities
                }}
              </p>
              <p class="mt-0.5 break-all font-mono">
                {{ dialogs.pluginDigest({ digest: runtimeReview.runtimePackageDigest }) }}
              </p>
              <p v-if="runtimeReview.executionReason" class="mt-1 text-warning">
                runtime-unavailable · {{ runtimeReview.executionReason }}
              </p>
            </div>

            <div class="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                class="rounded border border-border px-2 py-1 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
                :disabled="
                  !plugin.enabled ||
                  Boolean(plugin.blockedReason) ||
                  runtimeBusyPluginId === pluginId(plugin)
                "
                :data-test-id="`plugin-runtime-review-${pluginId(plugin)}`"
                @click="reviewRuntime(pluginId(plugin))"
              >
                {{ dialogs.pluginRuntimeReview }}
              </button>
              <button
                type="button"
                class="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50"
                :disabled="
                  !runtimeReview ||
                  runtimeReview.executionStatus !== 'eligible' ||
                  runtimeGrantActive(runtimePolicy, runtimeReview) ||
                  runtimeBusyPluginId === pluginId(plugin)
                "
                :data-test-id="`plugin-runtime-grant-${pluginId(plugin)}`"
                @click="grantRuntime(pluginId(plugin), runtimeReview)"
              >
                {{ dialogs.pluginRuntimeGrant }}
              </button>
              <button
                type="button"
                class="rounded border border-border px-2 py-1 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
                :disabled="
                  !runtimePolicy?.grantedAt ||
                  Boolean(runtimePolicy.revokedAt) ||
                  runtimeBusyPluginId === pluginId(plugin)
                "
                :data-test-id="`plugin-runtime-revoke-${pluginId(plugin)}`"
                @click="revokeRuntime(pluginId(plugin))"
              >
                {{ dialogs.pluginRuntimeRevoke }}
              </button>
              <button
                type="button"
                class="rounded border border-border px-2 py-1 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
                :disabled="
                  !runtimeGrantActive(runtimePolicy, runtimeReview) ||
                  runtimeBusyPluginId === pluginId(plugin)
                "
                :data-test-id="`plugin-runtime-run-${pluginId(plugin)}`"
                @click="runRuntime(pluginId(plugin))"
              >
                {{ dialogs.pluginRuntimeRun }}
              </button>
            </div>

            <p v-if="runtimeError" class="mt-2 break-words text-[9px] text-error" role="alert">
              {{ runtimeError }}
            </p>
            <div v-if="runtimeOutput" class="mt-2 text-[9px]">
              <p class="text-muted">{{ dialogs.pluginRuntimeOutput }}</p>
              <pre class="mt-1 overflow-auto rounded bg-input p-1.5 font-mono text-surface">{{
                runtimeOutput
              }}</pre>
            </div>

            <div class="mt-2 border-t border-border/70 pt-2 text-[9px] text-muted">
              <p class="font-medium text-surface">{{ dialogs.pluginRuntimeAudit }}</p>
              <ol v-if="runtimePolicy?.audit.length" class="mt-1 flex flex-col gap-0.5 font-mono">
                <li v-for="event in runtimePolicy.audit.slice(-5)" :key="event.sequence">
                  #{{ event.sequence }} · {{ event.action }} · {{ event.occurredAt }}
                  <span v-if="event.reasonCode"> · {{ event.reasonCode }}</span>
                </li>
              </ol>
              <p v-else class="mt-1">{{ dialogs.pluginRuntimeAuditEmpty }}</p>
            </div>
          </section>

          <div class="mt-3 flex flex-wrap items-center gap-1.5">
            <div
              v-for="contribution in plugin.package.manifest.contributions.modules"
              :key="contribution.moduleType"
              class="flex flex-col items-start gap-1"
            >
              <button
                type="button"
                class="rounded bg-accent px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50"
                :disabled="
                  !plugin.enabled ||
                  Boolean(plugin.blockedReason) ||
                  !moduleCompatibility(pluginId(plugin), contribution).ok ||
                  busyPluginId === pluginId(plugin)
                "
                :data-test-id="`plugin-add-${pluginId(plugin)}-${contribution.moduleType}`"
                @click="addModule(plugin, contribution)"
              >
                <icon-lucide-plus class="mr-1 inline size-3" />
                {{ dialogs.pluginAddToCanvas }} ·
                {{
                  contributionDisplayName(
                    pluginId(plugin),
                    contribution.moduleType,
                    contribution.name
                  )
                }}
              </button>
              <span
                v-if="!moduleCompatibility(pluginId(plugin), contribution).ok"
                class="max-w-44 text-[9px] text-error"
                :data-test-id="`plugin-adapter-compatibility-${pluginId(plugin)}-${contribution.moduleType}`"
              >
                {{
                  moduleCompatibilityLabel(
                    moduleCompatibility(pluginId(plugin), contribution).status
                  )
                }}
              </span>
            </div>
            <div
              v-for="contribution in visibleCommands(plugin)"
              :key="contribution.commandId"
              class="flex flex-col items-start gap-1"
            >
              <button
                type="button"
                class="rounded bg-accent px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50"
                :disabled="
                  !plugin.enabled ||
                  Boolean(plugin.blockedReason) ||
                  !commandCompatibility(pluginId(plugin), contribution).ok ||
                  hostBusyKey !== null ||
                  busyPluginId === pluginId(plugin)
                "
                :data-test-id="`plugin-command-${pluginId(plugin)}-${contribution.commandId}`"
                @click="runCommand(plugin, contribution)"
              >
                <icon-lucide-clipboard-copy class="mr-1 inline size-3" />
                {{
                  contributionDisplayName(
                    pluginId(plugin),
                    contribution.commandId,
                    contribution.name
                  )
                }}
              </button>
              <span
                v-if="!commandCompatibility(pluginId(plugin), contribution).ok"
                class="max-w-52 text-[9px] text-error"
              >
                {{ hostCompatibilityReason(commandCompatibility(pluginId(plugin), contribution)) }}
              </span>
            </div>
            <div
              v-for="contribution in plugin.package.manifest.contributions.exporters ?? []"
              :key="contribution.exporterId"
              class="flex flex-col items-start gap-1"
            >
              <button
                type="button"
                class="min-h-11 rounded bg-accent px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50"
                :disabled="
                  !plugin.enabled ||
                  Boolean(plugin.blockedReason) ||
                  !exporterCompatibility(pluginId(plugin), contribution).ok ||
                  hostBusyKey !== null ||
                  appPluginExportSessionSnapshot !== null ||
                  busyPluginId === pluginId(plugin)
                "
                :data-test-id="`plugin-exporter-${pluginId(plugin)}-${contribution.exporterId}`"
                @click="runExporter(plugin, contribution)"
              >
                <icon-lucide-package-open class="mr-1 inline size-3" />
                {{
                  contributionDisplayName(
                    pluginId(plugin),
                    contribution.exporterId,
                    contribution.name
                  )
                }}
              </button>
              <span
                v-if="!exporterCompatibility(pluginId(plugin), contribution).ok"
                class="max-w-52 text-[9px] text-error"
              >
                {{ hostCompatibilityReason(exporterCompatibility(pluginId(plugin), contribution)) }}
              </span>
              <div
                v-if="pluginExporterStageLabel(pluginId(plugin), contribution.exporterId)"
                class="flex min-h-11 w-full min-w-64 items-center justify-between gap-2 rounded border border-accent/30 bg-accent/5 px-2"
                :data-test-id="`plugin-export-progress-${pluginId(plugin)}-${contribution.exporterId}`"
              >
                <p
                  class="flex min-w-0 items-center gap-1.5 text-[10px] text-surface"
                  role="status"
                  aria-live="polite"
                >
                  <icon-lucide-loader-circle
                    class="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                  />
                  <span class="truncate">
                    {{ pluginExporterStageLabel(pluginId(plugin), contribution.exporterId) }}
                  </span>
                </p>
                <button
                  v-if="supportsPluginExporterCancellation(pluginId(plugin), contribution)"
                  type="button"
                  class="min-h-11 shrink-0 rounded px-2 text-[10px] font-medium text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
                  :disabled="appPluginExportSessionSnapshot?.stage === 'cancelling'"
                  :data-test-id="`plugin-export-cancel-${pluginId(plugin)}-${contribution.exporterId}`"
                  @click="cancelAppPluginExport(pluginId(plugin))"
                >
                  {{ dialogs.pluginExportCancel }}
                </button>
              </div>
            </div>
            <button
              type="button"
              class="rounded border border-border px-2 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
              :disabled="busyPluginId === pluginId(plugin)"
              :data-test-id="`plugin-pin-${pluginId(plugin)}`"
              @click="setPinned(plugin)"
            >
              {{ plugin.pinnedDigest ? dialogs.pluginUnpin : dialogs.pluginPin }}
            </button>
            <button
              v-if="plugin.installedState?.history.length"
              type="button"
              class="rounded border border-border px-2 py-1 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
              :disabled="
                Boolean(plugin.pinnedDigest) ||
                busyPluginId === pluginId(plugin) ||
                isDeploymentPluginSessionActive(pluginId(plugin)) ||
                isPluginExportActive(pluginId(plugin))
              "
              :data-test-id="`plugin-rollback-${pluginId(plugin)}`"
              @click="requestRollback(plugin)"
            >
              {{ dialogs.pluginRollback }} ·
              {{ plugin.installedState.history[0]?.manifest.plugin.version }}
            </button>
            <button
              type="button"
              class="ml-auto rounded px-2 py-1 text-[10px] text-danger hover:bg-danger/10 disabled:opacity-50"
              :disabled="
                busyPluginId === pluginId(plugin) ||
                isDeploymentPluginSessionActive(pluginId(plugin)) ||
                isPluginExportActive(pluginId(plugin))
              "
              :data-test-id="`plugin-uninstall-${pluginId(plugin)}`"
              @click="pendingUninstallId = pluginId(plugin)"
            >
              {{ dialogs.pluginUninstall }}
            </button>
          </div>
        </article>
      </div>
      <p
        v-else
        class="rounded border border-dashed border-border p-4 text-center text-[10px] text-muted"
      >
        {{ dialogs.pluginsEmptyInstalled }}
      </p>

      <section
        class="mt-1 rounded border border-border bg-panel-field p-3"
        data-test-id="plugin-document-dependencies"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h4 class="text-[11px] font-medium text-surface">
              {{ dialogs.pluginDocumentDependencies }}
            </h4>
            <p class="mt-0.5 text-[9px] text-muted">
              {{ dialogs.pluginDocumentDependenciesDescription }}
            </p>
          </div>
          <AppBadge
            :tone="
              documentDependencies.lock.status === 'valid'
                ? 'success'
                : documentDependencies.lock.status === 'invalid'
                  ? 'error'
                  : 'warning'
            "
            data-test-id="plugin-document-lock-status"
          >
            {{ documentLockLabel() }}
          </AppBadge>
        </div>

        <p
          v-if="documentDependencies.lock.status === 'invalid'"
          class="mt-2 break-words text-[9px] text-error"
          role="alert"
        >
          {{ documentDependencies.lock.error.message }}
        </p>

        <div
          v-if="documentDependencies.invalidModuleCount > 0"
          class="mt-2 rounded border border-error/30 bg-error/5 px-2 py-1.5 text-[9px] text-error"
          role="alert"
          data-test-id="plugin-document-invalid-modules"
        >
          <p>
            {{
              dialogs.pluginDocumentInvalidModules({
                count: documentDependencies.invalidModuleCount
              })
            }}
          </p>
          <p
            v-for="invalidModule in documentDependencies.invalidModules"
            :key="invalidModule.nodeId"
            class="break-words"
          >
            {{ invalidModule.nodeId }}: {{ invalidModule.reason }}
          </p>
          <p
            v-if="
              documentDependencies.invalidModuleCount > documentDependencies.invalidModules.length
            "
          >
            {{
              dialogs.pluginDocumentInvalidModulesTruncated({
                count:
                  documentDependencies.invalidModuleCount -
                  documentDependencies.invalidModules.length
              })
            }}
          </p>
        </div>

        <div v-if="documentDependencies.dependencies.length" class="mt-2 flex flex-col gap-1.5">
          <div
            v-for="dependency in documentDependencies.dependencies"
            :key="dependency.pluginId"
            class="flex items-start gap-2 rounded border border-border/70 px-2 py-1.5"
            :data-test-id="`plugin-document-dependency-${dependency.pluginId}`"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-[10px] font-medium text-surface">
                {{ dependency.pluginId }}
              </p>
              <p class="truncate text-[9px] text-muted">
                {{
                  dialogs.pluginDocumentDependencyModules({
                    modules: dependencyModulesLabel(dependency)
                  })
                }}
              </p>
              <p
                v-for="invalidConfig in dependency.invalidModuleConfigs"
                :key="`${invalidConfig.nodeId}:${invalidConfig.moduleType}`"
                class="break-words text-[9px] text-error"
              >
                {{ invalidConfig.nodeId }}: {{ invalidConfig.reason }}
              </p>
            </div>
            <AppBadge :tone="dependency.status === 'ready' ? 'success' : 'warning'">
              {{ dependencyStatusLabel(dependency.status) }}
            </AppBadge>
          </div>
        </div>
        <p
          v-else-if="documentDependencies.invalidModuleCount === 0"
          class="mt-2 text-[9px] text-muted"
        >
          {{ dialogs.pluginDocumentDependenciesEmpty }}
        </p>

        <div class="mt-2 flex items-center gap-2">
          <button
            type="button"
            class="rounded border border-border px-2 py-1 text-[10px] text-surface hover:bg-hover disabled:opacity-50"
            :disabled="!canWriteDocumentLock"
            data-test-id="plugin-document-write-lock"
            @click="writeDocumentLock"
          >
            {{ dialogs.pluginDocumentWriteLock }}
          </button>
          <p v-if="documentLockMessage" class="text-[9px] text-success" role="status">
            {{ documentLockMessage }}
          </p>
        </div>
      </section>
    </template>

    <div
      v-if="hostActionMessage || hostActionData !== undefined || operationError"
      ref="hostActionResult"
      class="flex flex-col gap-2 outline-none"
      tabindex="-1"
      data-test-id="plugin-host-action-result"
    >
      <p
        v-if="hostActionMessage"
        class="text-[10px]"
        :class="hostActionStatus === 'completed' ? 'text-success' : 'text-muted'"
        role="status"
      >
        {{ hostActionMessage }}
      </p>
      <AccessibilityAuditReport :data="hostActionData" />
      <ApplicationSecurityReadinessReport :data="hostActionData" />
      <PluginExporterResult :data="hostActionData" />
      <p v-if="operationError" class="text-[10px] text-danger" role="alert">
        {{ operationError }}
      </p>
    </div>
  </section>

  <AppAlertDialogRoot
    :open="pendingUninstall !== null"
    data-test-id="plugin-uninstall-dialog"
    @update:open="pendingUninstallId = $event ? pendingUninstallId : null"
  >
    <div class="border-b border-border px-4 py-3">
      <AlertDialogTitle class="text-sm font-semibold text-surface">
        {{ dialogs.pluginUninstallTitle }}
      </AlertDialogTitle>
    </div>
    <AppDialogBody>
      <AlertDialogDescription class="text-xs text-muted">
        {{
          dialogs.pluginUninstallDescription({
            name: pendingUninstall ? pluginDisplayName(pendingUninstall.package.manifest) : ''
          })
        }}
      </AlertDialogDescription>
    </AppDialogBody>
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <button class="rounded px-3 py-1.5 text-xs text-muted hover:bg-hover">
          {{ dialogs.cancel }}
        </button>
      </AlertDialogCancel>
      <button
        class="rounded bg-danger px-3 py-1.5 text-xs text-white disabled:opacity-50"
        :disabled="
          pendingUninstall
            ? isDeploymentPluginSessionActive(pluginId(pendingUninstall)) ||
              isPluginExportActive(pluginId(pendingUninstall))
            : false
        "
        data-test-id="plugin-uninstall-confirm"
        @click="confirmUninstall"
      >
        {{ dialogs.pluginUninstall }}
      </button>
    </AppDialogFooter>
  </AppAlertDialogRoot>

  <AppAlertDialogRoot
    :open="pendingResetIssue !== null"
    data-test-id="plugin-reset-local-state-dialog"
    @update:open="pendingResetPluginId = $event ? pendingResetPluginId : null"
  >
    <div class="border-b border-border px-4 py-3">
      <AlertDialogTitle class="text-sm font-semibold text-surface">
        {{ dialogs.pluginResetLocalStateTitle }}
      </AlertDialogTitle>
    </div>
    <AppDialogBody>
      <AlertDialogDescription class="text-xs text-muted">
        {{
          dialogs.pluginResetLocalStateDescription({
            pluginId: pendingResetIssue?.pluginId ?? ''
          })
        }}
      </AlertDialogDescription>
    </AppDialogBody>
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <button
          class="rounded px-3 py-1.5 text-xs text-muted hover:bg-hover"
          data-test-id="plugin-reset-local-state-cancel"
        >
          {{ dialogs.cancel }}
        </button>
      </AlertDialogCancel>
      <button
        class="rounded bg-danger px-3 py-1.5 text-xs text-white disabled:opacity-50"
        :disabled="
          pendingResetIssue
            ? isDeploymentPluginSessionActive(pendingResetIssue.pluginId) ||
              isPluginExportActive(pendingResetIssue.pluginId)
            : false
        "
        data-test-id="plugin-reset-local-state-confirm"
        @click="confirmResetLocalState"
      >
        {{ dialogs.pluginResetLocalStateConfirm }}
      </button>
    </AppDialogFooter>
  </AppAlertDialogRoot>

  <AppAlertDialogRoot
    :open="pendingPinReplacement !== null"
    data-test-id="plugin-replace-pin-dialog"
    @update:open="pendingPinReplacementId = $event ? pendingPinReplacementId : null"
  >
    <div class="border-b border-border px-4 py-3">
      <AlertDialogTitle class="text-sm font-semibold text-surface">
        {{ dialogs.pluginReplacePinTitle }}
      </AlertDialogTitle>
    </div>
    <AppDialogBody>
      <AlertDialogDescription class="text-xs text-muted">
        {{ dialogs.pluginReplacePinDescription }}
      </AlertDialogDescription>
      <div class="mt-3 flex flex-col gap-2 text-[10px] text-muted">
        <p class="break-all" data-test-id="plugin-replace-pin-previous-digest">
          {{
            dialogs.pluginPreviousDigest({
              digest: pendingPinReplacement?.previousDigest ?? ''
            })
          }}
        </p>
        <p class="break-all" data-test-id="plugin-replace-pin-new-digest">
          {{
            dialogs.pluginNewDigest({
              digest: pendingPinReplacement?.catalogDigest ?? ''
            })
          }}
        </p>
      </div>
    </AppDialogBody>
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <button class="rounded px-3 py-1.5 text-xs text-muted hover:bg-hover">
          {{ dialogs.cancel }}
        </button>
      </AlertDialogCancel>
      <button
        class="rounded bg-danger px-3 py-1.5 text-xs text-white"
        data-test-id="plugin-replace-pin-confirm"
        @click="confirmPinReplacement"
      >
        {{ dialogs.pluginReplacePinConfirm }}
      </button>
    </AppDialogFooter>
  </AppAlertDialogRoot>

  <AppAlertDialogRoot
    :open="pendingRollbackPlugin !== null"
    data-test-id="plugin-rollback-dialog"
    @update:open="pendingRollback = $event ? pendingRollback : null"
  >
    <div class="border-b border-border px-4 py-3">
      <AlertDialogTitle class="text-sm font-semibold text-surface">
        {{ dialogs.pluginRollbackTitle }}
      </AlertDialogTitle>
    </div>
    <AppDialogBody>
      <AlertDialogDescription class="text-xs text-muted">
        {{
          dialogs.pluginRollbackDescription({
            name: pendingRollbackPlugin
              ? pluginDisplayName(pendingRollbackPlugin.plugin.package.manifest)
              : '',
            version: pendingRollbackPlugin?.target.manifest.plugin.version ?? ''
          })
        }}
      </AlertDialogDescription>
      <p class="mt-2 break-all text-[10px] text-muted">
        {{
          dialogs.pluginDigest({
            digest: pendingRollbackPlugin?.target.verifiedDigest ?? ''
          })
        }}
      </p>
    </AppDialogBody>
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <button class="rounded px-3 py-1.5 text-xs text-muted hover:bg-hover">
          {{ dialogs.cancel }}
        </button>
      </AlertDialogCancel>
      <button
        class="rounded bg-danger px-3 py-1.5 text-xs text-white disabled:opacity-50"
        :disabled="
          pendingRollbackPlugin
            ? isDeploymentPluginSessionActive(pluginId(pendingRollbackPlugin.plugin)) ||
              isPluginExportActive(pluginId(pendingRollbackPlugin.plugin))
            : false
        "
        data-test-id="plugin-rollback-confirm"
        @click="confirmRollback"
      >
        {{ dialogs.pluginRollbackConfirm }}
      </button>
    </AppDialogFooter>
  </AppAlertDialogRoot>
</template>
