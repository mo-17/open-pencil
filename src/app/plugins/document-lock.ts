import {
  PLUGIN_DOCUMENT_LOCK_FORMAT,
  PLUGIN_DOCUMENT_LOCK_LIMITS,
  PLUGIN_DOCUMENT_LOCK_SCHEMA_VERSION,
  parsePluginDocumentLock,
  serializePluginDocumentLock,
  validateModuleInstance,
  type ModuleInstanceV1,
  type PluginDocumentLockEntryV1,
  type PluginDocumentLockV1,
  type SceneGraph
} from '@open-pencil/scene-graph'

import { inspectPluginModuleCompatibility } from './modules'
import type { InstalledAppPlugin } from './types'

export const APP_PLUGIN_DOCUMENT_DATA_ID = 'open-pencil.plugins' as const
export const APP_PLUGIN_DOCUMENT_LOCK_KEY = 'document-lock' as const

export type AppPluginDocumentLockReadResult =
  | Readonly<{ status: 'absent'; lock: null; error: null }>
  | Readonly<{ status: 'valid'; lock: PluginDocumentLockV1; error: null }>
  | Readonly<{ status: 'invalid'; lock: null; error: Error }>

export type AppPluginDocumentDependencyStatus =
  | 'ready'
  | 'lock-missing'
  | 'lock-entry-missing'
  | 'not-installed'
  | 'disabled'
  | 'unsupported-module'
  | 'config-version-mismatch'
  | 'unsupported-host-adapter'
  | 'invalid-module-config'
  | 'version-mismatch'
  | 'digest-mismatch'
  | 'publisher-key-mismatch'

export type AppPluginDocumentDependency = Readonly<{
  pluginId: string
  moduleTypes: readonly string[]
  modules: readonly AppPluginDocumentModuleReference[]
  status: AppPluginDocumentDependencyStatus
  lock: PluginDocumentLockEntryV1 | null
  installed: InstalledAppPlugin | null
  invalidModuleConfigs: readonly AppPluginDocumentInvalidModuleConfig[]
}>

export type AppPluginDocumentModuleReference = Readonly<{
  moduleType: string
  configVersions: readonly number[]
}>

export type AppPluginDocumentInvalidModule = Readonly<{
  nodeId: string
  reason: string
}>

export type AppPluginDocumentInvalidModuleConfig = Readonly<{
  nodeId: string
  moduleType: string
  reason: string
}>

export type AppPluginDocumentDependencyReport = Readonly<{
  ok: boolean
  lock: AppPluginDocumentLockReadResult
  dependencies: readonly AppPluginDocumentDependency[]
  invalidModules: readonly AppPluginDocumentInvalidModule[]
  invalidModuleCount: number
}>

function documentLockEntries(graph: SceneGraph) {
  const root = graph.getNode(graph.rootId)
  return (
    root?.pluginData.filter(
      (entry) =>
        entry.pluginId === APP_PLUGIN_DOCUMENT_DATA_ID && entry.key === APP_PLUGIN_DOCUMENT_LOCK_KEY
    ) ?? []
  )
}

export function readAppPluginDocumentLock(graph: SceneGraph): AppPluginDocumentLockReadResult {
  const entries = documentLockEntries(graph)
  if (entries.length === 0) return { status: 'absent', lock: null, error: null }
  if (entries.length !== 1) {
    return {
      status: 'invalid',
      lock: null,
      error: new TypeError('Document contains duplicate plugin lock records')
    }
  }
  try {
    const value = entries[0].value
    if (new TextEncoder().encode(value).byteLength > PLUGIN_DOCUMENT_LOCK_LIMITS.maxJsonBytes) {
      throw new TypeError(
        `Document plugin lock exceeds ${PLUGIN_DOCUMENT_LOCK_LIMITS.maxJsonBytes} UTF-8 bytes`
      )
    }
    return {
      status: 'valid',
      lock: parsePluginDocumentLock(JSON.parse(value)),
      error: null
    }
  } catch (cause) {
    return {
      status: 'invalid',
      lock: null,
      error: cause instanceof Error ? cause : new Error(String(cause))
    }
  }
}

type ReferencedModuleInstance = Readonly<{
  nodeId: string
  instance: ModuleInstanceV1
}>

type ReferencedModules = Map<string, Map<string, ReferencedModuleInstance[]>>

type ReferencedModuleScan = Readonly<{
  modules: ReferencedModules
  invalidModules: readonly AppPluginDocumentInvalidModule[]
  invalidModuleCount: number
}>

const MAX_REPORTED_INVALID_MODULES = PLUGIN_DOCUMENT_LOCK_LIMITS.maxPlugins

function referencedModules(graph: SceneGraph): ReferencedModuleScan {
  const modules: ReferencedModules = new Map()
  const invalidModules: AppPluginDocumentInvalidModule[] = []
  let invalidModuleCount = 0
  for (const node of graph.getAllNodes()) {
    const interactiveProps = node.interactiveProps
    if (!interactiveProps || !Object.hasOwn(interactiveProps, 'module')) continue
    const validation = validateModuleInstance(interactiveProps.module)
    if (!validation.ok) {
      invalidModuleCount += 1
      if (invalidModules.length < MAX_REPORTED_INVALID_MODULES) {
        invalidModules.push({ nodeId: node.id, reason: validation.reason })
      }
      continue
    }
    const { value: instance } = validation
    const moduleTypes =
      modules.get(instance.pluginId) ?? new Map<string, ReferencedModuleInstance[]>()
    const instances = moduleTypes.get(instance.moduleType) ?? []
    instances.push({ nodeId: node.id, instance })
    moduleTypes.set(instance.moduleType, instances)
    modules.set(instance.pluginId, moduleTypes)
  }
  return { modules, invalidModules, invalidModuleCount }
}

function moduleReferences(
  moduleTypes: Map<string, ReferencedModuleInstance[]>
): AppPluginDocumentModuleReference[] {
  return [...moduleTypes]
    .map(([moduleType, instances]) => ({
      moduleType,
      configVersions: [...new Set(instances.map(({ instance }) => instance.configVersion))].sort(
        (left, right) => left - right
      )
    }))
    .sort((left, right) => left.moduleType.localeCompare(right.moduleType))
}

function acceptedManifest(plugin: InstalledAppPlugin) {
  return plugin.installedState?.accepted.manifest ?? plugin.package.manifest
}

type ManifestModuleValidation = Readonly<{
  status:
    | 'unsupported-module'
    | 'config-version-mismatch'
    | 'unsupported-host-adapter'
    | 'invalid-module-config'
    | null
  invalidModuleConfigs: readonly AppPluginDocumentInvalidModuleConfig[]
}>

function manifestModuleValidation(
  plugin: InstalledAppPlugin,
  modules: Map<string, ReferencedModuleInstance[]>
): ManifestModuleValidation {
  const pluginId = acceptedManifest(plugin).plugin.id
  const contributions = new Map(
    acceptedManifest(plugin).contributions.modules.map((contribution) => [
      contribution.moduleType,
      contribution
    ])
  )
  const invalidModuleConfigs: AppPluginDocumentInvalidModuleConfig[] = []
  for (const [moduleType, instances] of modules) {
    const contribution = contributions.get(moduleType)
    if (!contribution) return { status: 'unsupported-module', invalidModuleConfigs }
    if (instances.some(({ instance }) => instance.configVersion !== contribution.configVersion)) {
      return { status: 'config-version-mismatch', invalidModuleConfigs }
    }
    const compatibility = inspectPluginModuleCompatibility(pluginId, contribution)
    if (!compatibility.ok) {
      return { status: 'unsupported-host-adapter', invalidModuleConfigs }
    }
    for (const { nodeId, instance } of instances) {
      const resolution = compatibility.definition.resolve(instance)
      if (!resolution?.ok) {
        invalidModuleConfigs.push({
          nodeId,
          moduleType,
          reason: resolution?.reason ?? 'Host adapter did not resolve the module instance'
        })
      }
    }
  }
  return {
    status: invalidModuleConfigs.length > 0 ? 'invalid-module-config' : null,
    invalidModuleConfigs
  }
}

function acceptedSnapshot(plugin: InstalledAppPlugin): PluginDocumentLockEntryV1 {
  const accepted = plugin.installedState?.accepted
  const manifest = accepted?.manifest ?? plugin.package.manifest
  const digest =
    accepted?.verifiedDigest ?? plugin.package.digest.replace(/^app-bundle-sha256:/, '')
  return {
    pluginId: manifest.plugin.id,
    version: manifest.plugin.version,
    manifestDigest: digest,
    publisherKeyId: accepted?.verifiedKeyId ?? manifest.publisher.keyId
  }
}

export function createAppPluginDocumentLock(
  graph: SceneGraph,
  installedPlugins: readonly InstalledAppPlugin[]
): PluginDocumentLockV1 {
  const referenced = referencedModules(graph)
  if (referenced.invalidModuleCount > 0) {
    const first = referenced.invalidModules[0]
    throw new Error(`Document module envelope is invalid at ${first.nodeId}: ${first.reason}`)
  }
  const installed = new Map(
    installedPlugins.map((plugin) => [plugin.package.manifest.plugin.id, plugin])
  )
  const plugins = [...referenced.modules].map(([pluginId, moduleTypes]) => {
    const plugin = installed.get(pluginId)
    if (!plugin) throw new Error(`Document plugin is not installed: ${pluginId}`)
    const validation = manifestModuleValidation(plugin, moduleTypes)
    const moduleStatus = validation.status
    if (moduleStatus === 'unsupported-module') {
      throw new Error(`Document references a module not declared by plugin ${pluginId}`)
    }
    if (moduleStatus === 'config-version-mismatch') {
      throw new Error(`Document module config version is incompatible with plugin ${pluginId}`)
    }
    if (moduleStatus === 'unsupported-host-adapter') {
      throw new Error(`Document plugin module has no compatible host adapter: ${pluginId}`)
    }
    if (moduleStatus === 'invalid-module-config') {
      const first = validation.invalidModuleConfigs[0]
      throw new Error(`Document module config is invalid at ${first.nodeId}: ${first.reason}`)
    }
    return acceptedSnapshot(plugin)
  })
  return parsePluginDocumentLock({
    format: PLUGIN_DOCUMENT_LOCK_FORMAT,
    schemaVersion: PLUGIN_DOCUMENT_LOCK_SCHEMA_VERSION,
    plugins
  })
}

export function writeAppPluginDocumentLock(
  graph: SceneGraph,
  installedPlugins: readonly InstalledAppPlugin[]
): PluginDocumentLockV1 {
  const lock = createAppPluginDocumentLock(graph, installedPlugins)
  const root = graph.getNode(graph.rootId)
  if (!root) throw new Error('Document root is unavailable')
  graph.updateNode(root.id, {
    pluginData: [
      ...root.pluginData.filter(
        (entry) =>
          entry.pluginId !== APP_PLUGIN_DOCUMENT_DATA_ID ||
          entry.key !== APP_PLUGIN_DOCUMENT_LOCK_KEY
      ),
      {
        pluginId: APP_PLUGIN_DOCUMENT_DATA_ID,
        key: APP_PLUGIN_DOCUMENT_LOCK_KEY,
        value: serializePluginDocumentLock(lock)
      }
    ]
  })
  return lock
}

function dependencyStatus(
  plugin: InstalledAppPlugin | undefined,
  moduleValidation: ManifestModuleValidation | null,
  lock: PluginDocumentLockEntryV1 | undefined,
  lockStatus: AppPluginDocumentLockReadResult['status']
): AppPluginDocumentDependencyStatus {
  if (!plugin) return 'not-installed'
  const moduleStatus = moduleValidation?.status
  if (moduleStatus) return moduleStatus
  if (!plugin.enabled) return 'disabled'
  if (lockStatus === 'absent') return 'lock-missing'
  if (!lock) return 'lock-entry-missing'
  const accepted = acceptedSnapshot(plugin)
  if (accepted.publisherKeyId !== lock.publisherKeyId) return 'publisher-key-mismatch'
  if (accepted.version !== lock.version) return 'version-mismatch'
  if (accepted.manifestDigest !== lock.manifestDigest) return 'digest-mismatch'
  return 'ready'
}

export function resolveAppPluginDocumentDependencies(
  graph: SceneGraph,
  installedPlugins: readonly InstalledAppPlugin[]
): AppPluginDocumentDependencyReport {
  const lock = readAppPluginDocumentLock(graph)
  const referenced = referencedModules(graph)
  const lockEntries = new Map(
    lock.status === 'valid' ? lock.lock.plugins.map((entry) => [entry.pluginId, entry]) : []
  )
  const installed = new Map(
    installedPlugins.map((plugin) => [plugin.package.manifest.plugin.id, plugin])
  )
  const dependencies = [...referenced.modules]
    .map(([pluginId, moduleTypes]) => {
      const installedPlugin = installed.get(pluginId)
      const lockedPlugin = lockEntries.get(pluginId)
      const modules = moduleReferences(moduleTypes)
      const moduleValidation = installedPlugin
        ? manifestModuleValidation(installedPlugin, moduleTypes)
        : null
      return {
        pluginId,
        moduleTypes: modules.map((module) => module.moduleType),
        modules,
        status: dependencyStatus(installedPlugin, moduleValidation, lockedPlugin, lock.status),
        lock: lockedPlugin ?? null,
        installed: installedPlugin ?? null,
        invalidModuleConfigs: moduleValidation?.invalidModuleConfigs ?? []
      }
    })
    .sort((left, right) => left.pluginId.localeCompare(right.pluginId))
  return {
    ok:
      referenced.invalidModuleCount === 0 &&
      lock.status !== 'invalid' &&
      dependencies.every((entry) => entry.status === 'ready'),
    lock,
    dependencies,
    invalidModules: referenced.invalidModules,
    invalidModuleCount: referenced.invalidModuleCount
  }
}
