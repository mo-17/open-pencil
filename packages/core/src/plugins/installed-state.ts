import {
  canonicalManifestJSON,
  compareStableSemver,
  parseBoundedManifestArray as array,
  parseExactManifestRecord as record,
  stableSemverParts
} from '@open-pencil/scene-graph'

import {
  authorizeTrustedPluginKeyTransition,
  resolveTrustedPluginKey,
  traceTrustedPluginKeyTransition,
  type PluginTrustTimeOptions,
  type TrustedPluginKeyringV1
} from './keyring'
import { parseVerifiedPluginPackageSnapshot, type VerifiedPluginPackage } from './package'

export const PLUGIN_INSTALLED_STATE_VERSION = 1 as const
export const PLUGIN_INSTALLED_HISTORY_LIMIT = 8

export interface PluginUpdateDiff {
  fromVersion: string | null
  toVersion: string
  addedModules: string[]
  removedModules: string[]
  updatedModules: string[]
  addedCommands: string[]
  removedCommands: string[]
  updatedCommands: string[]
  addedExporters: string[]
  removedExporters: string[]
  updatedExporters: string[]
  addedConnectors: string[]
  removedConnectors: string[]
  updatedConnectors: string[]
  addedStorageProviders: string[]
  removedStorageProviders: string[]
  updatedStorageProviders: string[]
}

export interface PluginUpdateReview {
  candidate: VerifiedPluginPackage
  diff: PluginUpdateDiff
  status: 'pending'
}

export interface InstalledPluginStateV1 {
  version: typeof PLUGIN_INSTALLED_STATE_VERSION
  enabled: boolean
  accepted: VerifiedPluginPackage
  history: VerifiedPluginPackage[]
  pending?: PluginUpdateReview
}

export interface InstalledPluginTrustOptions extends PluginTrustTimeOptions {
  trustedKeyring?: TrustedPluginKeyringV1
}

const STATE_KEYS = new Set(['version', 'enabled', 'accepted', 'history', 'pending'])
const PENDING_KEYS = new Set(['candidate', 'diff', 'status'])
const DIFF_KEYS = new Set([
  'fromVersion',
  'toVersion',
  'addedModules',
  'removedModules',
  'updatedModules',
  'addedCommands',
  'removedCommands',
  'updatedCommands',
  'addedExporters',
  'removedExporters',
  'updatedExporters',
  'addedConnectors',
  'removedConnectors',
  'updatedConnectors',
  'addedStorageProviders',
  'removedStorageProviders',
  'updatedStorageProviders'
])
const LEGACY_DIFF_KEYS = new Set([
  'fromVersion',
  'toVersion',
  'addedModules',
  'removedModules',
  'updatedModules'
])

function contributionList(value: unknown, path: string, contributionName: string): string[] {
  const entries = array(value, path, 64)
  if (entries.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${path} must contain ${contributionName} strings`)
  }
  return entries as string[]
}

function optionalContributionList(
  source: Record<string, unknown>,
  key: string,
  contributionName: string
): string[] {
  return Object.hasOwn(source, key)
    ? contributionList(source[key], `installedPlugin.pending.diff.${key}`, contributionName)
    : []
}

function updateDiff(value: unknown): PluginUpdateDiff {
  const source = record(value, 'installedPlugin.pending.diff', DIFF_KEYS, LEGACY_DIFF_KEYS)
  if (source.fromVersion !== null && typeof source.fromVersion !== 'string') {
    throw new TypeError('installedPlugin.pending.diff.fromVersion must be a string or null')
  }
  if (typeof source.toVersion !== 'string') {
    throw new TypeError('installedPlugin.pending.diff.toVersion must be a string')
  }
  return {
    fromVersion: source.fromVersion,
    toVersion: source.toVersion,
    addedModules: contributionList(
      source.addedModules,
      'installedPlugin.pending.diff.addedModules',
      'module type'
    ),
    removedModules: contributionList(
      source.removedModules,
      'installedPlugin.pending.diff.removedModules',
      'module type'
    ),
    updatedModules: contributionList(
      source.updatedModules,
      'installedPlugin.pending.diff.updatedModules',
      'module type'
    ),
    addedCommands: optionalContributionList(source, 'addedCommands', 'command ID'),
    removedCommands: optionalContributionList(source, 'removedCommands', 'command ID'),
    updatedCommands: optionalContributionList(source, 'updatedCommands', 'command ID'),
    addedExporters: optionalContributionList(source, 'addedExporters', 'exporter ID'),
    removedExporters: optionalContributionList(source, 'removedExporters', 'exporter ID'),
    updatedExporters: optionalContributionList(source, 'updatedExporters', 'exporter ID'),
    addedConnectors: optionalContributionList(source, 'addedConnectors', 'connector ID'),
    removedConnectors: optionalContributionList(source, 'removedConnectors', 'connector ID'),
    updatedConnectors: optionalContributionList(source, 'updatedConnectors', 'connector ID'),
    addedStorageProviders: optionalContributionList(
      source,
      'addedStorageProviders',
      'storage provider ID'
    ),
    removedStorageProviders: optionalContributionList(
      source,
      'removedStorageProviders',
      'storage provider ID'
    ),
    updatedStorageProviders: optionalContributionList(
      source,
      'updatedStorageProviders',
      'storage provider ID'
    )
  }
}

function matchingPlugin(
  current: VerifiedPluginPackage,
  candidate: VerifiedPluginPackage,
  options: InstalledPluginTrustOptions = {}
): void {
  if (
    current.manifest.plugin.id !== candidate.manifest.plugin.id ||
    current.manifest.publisher.id !== candidate.manifest.publisher.id
  ) {
    throw new TypeError('Plugin identity changed')
  }
  if (current.verifiedKeyId === candidate.verifiedKeyId) return
  if (!options.trustedKeyring) throw new TypeError('Plugin identity or signing key changed')
  const compared = compareStableSemver(
    stableSemverParts(current.manifest.plugin.version),
    stableSemverParts(candidate.manifest.plugin.version)
  )
  const earlier = compared <= 0 ? current : candidate
  const later = compared <= 0 ? candidate : current
  traceTrustedPluginKeyTransition(options.trustedKeyring, {
    pluginId: current.manifest.plugin.id,
    publisherId: current.manifest.publisher.id,
    fromKeyId: earlier.verifiedKeyId,
    toKeyId: later.verifiedKeyId,
    now: options.now
  })
}

function requireForwardVersion(
  current: VerifiedPluginPackage,
  candidate: VerifiedPluginPackage
): void {
  const compared = compareStableSemver(
    stableSemverParts(candidate.manifest.plugin.version),
    stableSemverParts(current.manifest.plugin.version)
  )
  if (compared === 0) {
    if (candidate.verifiedDigest !== current.verifiedDigest) {
      throw new TypeError('Plugin content changed without a version bump')
    }
    throw new TypeError('Plugin updates require a strictly greater version')
  }
  if (compared < 0) {
    throw new TypeError('Plugin updates cannot downgrade a plugin; use explicit rollback')
  }
}

function requireConsistentHistoricalVersion(
  history: readonly VerifiedPluginPackage[],
  candidate: VerifiedPluginPackage
): void {
  const historical = history.find(
    (snapshot) => snapshot.manifest.plugin.version === candidate.manifest.plugin.version
  )
  if (historical && historical.verifiedDigest !== candidate.verifiedDigest) {
    throw new TypeError('Plugin content changed for a previously verified version')
  }
}

function contributionMap(
  entries: readonly object[] | undefined,
  identityKey: 'moduleType' | 'commandId' | 'exporterId' | 'connectorId' | 'providerId'
): Map<string, string> {
  return new Map(
    entries?.map((entry) => [
      Reflect.get(entry, identityKey) as string,
      canonicalManifestJSON(entry)
    ])
  )
}

function contributionDiff(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>
): { added: string[]; removed: string[]; updated: string[] } {
  return {
    added: [...after.keys()].filter((id) => !before.has(id)).sort(),
    removed: [...before.keys()].filter((id) => !after.has(id)).sort(),
    updated: [...after.keys()]
      .filter((id) => before.has(id) && before.get(id) !== after.get(id))
      .sort()
  }
}

export function diffPluginPackages(
  currentValue: VerifiedPluginPackage | null,
  candidateValue: VerifiedPluginPackage
): PluginUpdateDiff {
  const current = currentValue ? parseVerifiedPluginPackageSnapshot(currentValue) : null
  const candidate = parseVerifiedPluginPackageSnapshot(candidateValue)
  const beforeModules = contributionMap(current?.manifest.contributions.modules, 'moduleType')
  const afterModules = contributionMap(candidate.manifest.contributions.modules, 'moduleType')
  const beforeCommands = contributionMap(current?.manifest.contributions.commands, 'commandId')
  const afterCommands = contributionMap(candidate.manifest.contributions.commands, 'commandId')
  const beforeExporters = contributionMap(current?.manifest.contributions.exporters, 'exporterId')
  const afterExporters = contributionMap(candidate.manifest.contributions.exporters, 'exporterId')
  const beforeConnectors = contributionMap(
    current?.manifest.schemaVersion === 2 ? current.manifest.contributions.connectors : undefined,
    'connectorId'
  )
  const afterConnectors = contributionMap(
    candidate.manifest.schemaVersion === 2
      ? candidate.manifest.contributions.connectors
      : undefined,
    'connectorId'
  )
  const beforeStorageProviders = contributionMap(
    current?.manifest.schemaVersion === 2
      ? current.manifest.contributions.storageProviders
      : undefined,
    'providerId'
  )
  const afterStorageProviders = contributionMap(
    candidate.manifest.schemaVersion === 2
      ? candidate.manifest.contributions.storageProviders
      : undefined,
    'providerId'
  )
  const modules = contributionDiff(beforeModules, afterModules)
  const commands = contributionDiff(beforeCommands, afterCommands)
  const exporters = contributionDiff(beforeExporters, afterExporters)
  const connectors = contributionDiff(beforeConnectors, afterConnectors)
  const storageProviders = contributionDiff(beforeStorageProviders, afterStorageProviders)
  return {
    fromVersion: current?.manifest.plugin.version ?? null,
    toVersion: candidate.manifest.plugin.version,
    addedModules: modules.added,
    removedModules: modules.removed,
    updatedModules: modules.updated,
    addedCommands: commands.added,
    removedCommands: commands.removed,
    updatedCommands: commands.updated,
    addedExporters: exporters.added,
    removedExporters: exporters.removed,
    updatedExporters: exporters.updated,
    addedConnectors: connectors.added,
    removedConnectors: connectors.removed,
    updatedConnectors: connectors.updated,
    addedStorageProviders: storageProviders.added,
    removedStorageProviders: storageProviders.removed,
    updatedStorageProviders: storageProviders.updated
  }
}

export function createInstalledPluginState(
  acceptedValue: VerifiedPluginPackage,
  options: { enabled?: boolean } = {}
): InstalledPluginStateV1 {
  return {
    version: PLUGIN_INSTALLED_STATE_VERSION,
    enabled: options.enabled ?? true,
    accepted: parseVerifiedPluginPackageSnapshot(acceptedValue),
    history: []
  }
}

export function reviewPluginUpdate(
  state: InstalledPluginStateV1,
  candidateValue: VerifiedPluginPackage,
  options: InstalledPluginTrustOptions = {}
): InstalledPluginStateV1 {
  const current = parseInstalledPluginState(state, options)
  const candidate = parseVerifiedPluginPackageSnapshot(candidateValue)
  matchingPlugin(current.accepted, candidate, options)
  requireForwardVersion(current.accepted, candidate)
  if (current.accepted.verifiedKeyId !== candidate.verifiedKeyId) {
    if (!options.trustedKeyring) throw new TypeError('Plugin identity or signing key changed')
    authorizeTrustedPluginKeyTransition(options.trustedKeyring, {
      pluginId: current.accepted.manifest.plugin.id,
      publisherId: current.accepted.manifest.publisher.id,
      fromKeyId: current.accepted.verifiedKeyId,
      toKeyId: candidate.verifiedKeyId,
      now: options.now
    })
  }
  requireConsistentHistoricalVersion(current.history, candidate)
  return {
    ...current,
    pending: {
      candidate,
      diff: diffPluginPackages(current.accepted, candidate),
      status: 'pending'
    }
  }
}

export function acceptPluginUpdate(
  state: InstalledPluginStateV1,
  options: InstalledPluginTrustOptions = {}
): InstalledPluginStateV1 {
  const current = parseInstalledPluginState(state, options)
  if (!current.pending) throw new TypeError('No pending plugin update review')
  const candidate = current.pending.candidate
  if (options.trustedKeyring) {
    resolveTrustedPluginKey(options.trustedKeyring, {
      pluginId: candidate.manifest.plugin.id,
      publisherId: candidate.manifest.publisher.id,
      keyId: candidate.verifiedKeyId,
      now: options.now
    })
  }
  return {
    version: PLUGIN_INSTALLED_STATE_VERSION,
    enabled: current.enabled,
    accepted: candidate,
    history: [
      current.accepted,
      ...current.history.filter(
        (snapshot) =>
          snapshot.verifiedDigest !== candidate.verifiedDigest &&
          snapshot.manifest.plugin.version !== candidate.manifest.plugin.version
      )
    ].slice(0, PLUGIN_INSTALLED_HISTORY_LIMIT)
  }
}

export function rejectPluginUpdate(
  state: InstalledPluginStateV1,
  options: InstalledPluginTrustOptions = {}
): InstalledPluginStateV1 {
  const current = parseInstalledPluginState(state, options)
  const { pending: _pending, ...withoutPending } = current
  return withoutPending
}

export function rollbackPlugin(
  state: InstalledPluginStateV1,
  targetVersionOrDigest: string,
  options: InstalledPluginTrustOptions = {}
): InstalledPluginStateV1 {
  const current = parseInstalledPluginState(state, options)
  const index = current.history.findIndex(
    (candidate) =>
      candidate.verifiedDigest === targetVersionOrDigest ||
      candidate.manifest.plugin.version === targetVersionOrDigest
  )
  if (index === -1) throw new TypeError('Unknown verified plugin history snapshot')
  const target = current.history[index]
  if (options.trustedKeyring) {
    resolveTrustedPluginKey(options.trustedKeyring, {
      pluginId: target.manifest.plugin.id,
      publisherId: target.manifest.publisher.id,
      keyId: target.verifiedKeyId,
      now: options.now
    })
  }
  return {
    version: PLUGIN_INSTALLED_STATE_VERSION,
    enabled: current.enabled,
    accepted: target,
    history: [
      current.accepted,
      ...current.history.filter((_, candidateIndex) => candidateIndex !== index)
    ].slice(0, PLUGIN_INSTALLED_HISTORY_LIMIT)
  }
}

export function setPluginEnabled(
  state: InstalledPluginStateV1,
  enabled: boolean,
  options: InstalledPluginTrustOptions = {}
): InstalledPluginStateV1 {
  if (typeof enabled !== 'boolean') throw new TypeError('Plugin enabled state must be boolean')
  const current = parseInstalledPluginState(state, options)
  if (enabled && options.trustedKeyring) {
    resolveTrustedPluginKey(options.trustedKeyring, {
      pluginId: current.accepted.manifest.plugin.id,
      publisherId: current.accepted.manifest.publisher.id,
      keyId: current.accepted.verifiedKeyId,
      now: options.now
    })
  }
  return { ...current, enabled }
}

export function parseInstalledPluginState(
  value: unknown,
  options: InstalledPluginTrustOptions = {}
): InstalledPluginStateV1 {
  const required = new Set(['version', 'enabled', 'accepted', 'history'])
  const source = record(value, 'installedPlugin', STATE_KEYS, required)
  if (source.version !== PLUGIN_INSTALLED_STATE_VERSION) {
    throw new TypeError('installedPlugin.version is not supported')
  }
  if (typeof source.enabled !== 'boolean') {
    throw new TypeError('installedPlugin.enabled must be boolean')
  }
  const accepted = parseVerifiedPluginPackageSnapshot(source.accepted)
  const history = array(
    source.history,
    'installedPlugin.history',
    PLUGIN_INSTALLED_HISTORY_LIMIT
  ).map(parseVerifiedPluginPackageSnapshot)
  const digests = new Set([accepted.verifiedDigest])
  const versions = new Set([accepted.manifest.plugin.version])
  history.forEach((candidate, index) => {
    matchingPlugin(accepted, candidate, options)
    if (digests.has(candidate.verifiedDigest) || versions.has(candidate.manifest.plugin.version)) {
      throw new TypeError(`installedPlugin.history[${index}] contains a duplicate snapshot`)
    }
    digests.add(candidate.verifiedDigest)
    versions.add(candidate.manifest.plugin.version)
  })
  let pending: PluginUpdateReview | undefined
  if (source.pending !== undefined) {
    const pendingSource = record(
      source.pending,
      'installedPlugin.pending',
      PENDING_KEYS,
      PENDING_KEYS
    )
    if (pendingSource.status !== 'pending') {
      throw new TypeError('installedPlugin.pending.status must be pending')
    }
    const candidate = parseVerifiedPluginPackageSnapshot(pendingSource.candidate)
    matchingPlugin(accepted, candidate, options)
    requireForwardVersion(accepted, candidate)
    requireConsistentHistoricalVersion(history, candidate)
    const expectedDiff = diffPluginPackages(accepted, candidate)
    if (
      canonicalManifestJSON(updateDiff(pendingSource.diff)) !== canonicalManifestJSON(expectedDiff)
    ) {
      throw new TypeError('installedPlugin.pending.diff does not match its snapshots')
    }
    pending = { candidate, diff: expectedDiff, status: 'pending' }
  }
  return {
    version: PLUGIN_INSTALLED_STATE_VERSION,
    enabled: source.enabled,
    accepted,
    history,
    ...(pending ? { pending } : {})
  }
}
