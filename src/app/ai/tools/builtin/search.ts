import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  inspectThirdPartyPluginAIEligibility,
  type ThirdPartyPluginAIContributionGrant
} from '@/app/plugins/ai-authorization'
import { isAppConnectorMCPStaticallyEligible } from '@/app/plugins/connectors/app'
import { inspectPluginCommandMCPExposure } from '@/app/plugins/host'
import { bundledPluginLocalizedSearchText } from '@/app/plugins/localization'
import {
  appPluginMCPConnectorContributionId,
  appPluginMCPToolAuthority,
  type AppPluginMCPToolCatalog,
  type AppPluginMCPToolDescriptor,
  type AppPluginMCPToolAuthority,
  type AppPluginMCPToolKind
} from '@/app/plugins/mcp'
import type {
  AppPluginCatalogItem,
  AppPluginStoreSnapshot,
  InstalledAppPlugin
} from '@/app/plugins/types'

import { boundedPluginAIString, BUILTIN_PLUGIN_AI_LIMITS, parsePluginAIPlainInput } from './input'

export type BuiltinPluginAIAvailability =
  | 'ready'
  | 'not-installed'
  | 'disabled'
  | 'blocked'
  | 'setup-required'
  | 'ai-grant-required'
  | 'not-ai-callable'

export interface BuiltinPluginAISearchMatch {
  pluginId: string
  pluginName: string
  availability: BuiltinPluginAIAvailability
  reason: string
  kind: AppPluginMCPToolKind
  contributionId: string
  title: string
  description: string
  trustSource: AppPluginMCPToolAuthority['trustSource']
  packageDigest: string
  pluginVersion: string
  publisherId: string
  publisherKeyId: string
  adapterId: string
  metadataTrust: 'host-authored' | 'publisher-signed-untrusted'
  grantId?: string
  toolName?: string
  inputSchema?: JSONObject
}

export interface BuiltinPluginAISearchResult {
  query: string
  revision: string
  matches: readonly BuiltinPluginAISearchMatch[]
}

export interface BuiltinPluginAISearchInput {
  query: string
  kind?: AppPluginMCPToolKind
  limit?: number
}

interface ManifestCapability {
  kind: AppPluginMCPToolKind
  contributionId: string
  title: string
  description: string
  adapterId: string
  connectorAIEligible?: boolean
}

export interface BuiltinPluginAISearchOptions {
  thirdPartyGrants?: readonly ThirdPartyPluginAIContributionGrant[]
}

interface RankedMatch {
  match: BuiltinPluginAISearchMatch
  score: number
}

const SEARCH_INPUT_KEYS = new Set(['query', 'kind', 'limit'])
const TOOL_KINDS = new Set<AppPluginMCPToolKind>(['module', 'command', 'exporter', 'connector'])

export function parseBuiltinPluginSearchInput(value: unknown): BuiltinPluginAISearchInput {
  const input = parsePluginAIPlainInput(value, 'Plugin search input', SEARCH_INPUT_KEYS)
  const query = boundedPluginAIString(
    input.query,
    'Plugin search query',
    BUILTIN_PLUGIN_AI_LIMITS.maxQueryLength
  )
  const kind = input.kind
  if (kind !== undefined && (typeof kind !== 'string' || !TOOL_KINDS.has(kind as never))) {
    throw new TypeError('Built-in plugin search kind is not supported')
  }
  const limit = input.limit
  if (
    limit !== undefined &&
    (typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > BUILTIN_PLUGIN_AI_LIMITS.maxMatches)
  ) {
    throw new TypeError(
      `Built-in plugin search limit must be between 1 and ${BUILTIN_PLUGIN_AI_LIMITS.maxMatches}`
    )
  }
  return {
    query,
    ...(kind === undefined ? {} : { kind: kind as AppPluginMCPToolKind }),
    ...(limit === undefined ? {} : { limit })
  }
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US')
}

function cjkBigrams(value: string): string[] {
  const terms: string[] = []
  for (const run of value.match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu
  ) ?? []) {
    if (run.length <= 2) terms.push(run)
    else
      for (let index = 0; index < run.length - 1; index++) terms.push(run.slice(index, index + 2))
  }
  return terms
}

function searchTerms(query: string): string[] {
  const normalized = normalizeSearchText(query)
  const terms = new Set<string>([normalized])
  for (const token of normalized.match(/[a-z0-9][a-z0-9._+-]*/g) ?? []) {
    if (token.length >= 2) terms.add(token)
  }
  for (const token of cjkBigrams(normalized)) terms.add(token)
  return [...terms]
}

function relevance(searchText: string, query: string, availability: BuiltinPluginAIAvailability) {
  const normalized = normalizeSearchText(searchText)
  const normalizedQuery = normalizeSearchText(query)
  let score = normalized.includes(normalizedQuery) ? 200 + normalizedQuery.length : 0
  for (const term of searchTerms(query)) {
    if (term !== normalizedQuery && normalized.includes(term)) score += 10 + term.length
  }
  if (score === 0) return 0
  if (availability === 'ready') score += 20
  else if (
    availability === 'disabled' ||
    availability === 'setup-required' ||
    availability === 'ai-grant-required'
  ) {
    score += 5
  }
  return score
}

function manifestCapabilities(item: AppPluginCatalogItem): ManifestCapability[] {
  const manifest = item.package.manifest
  const capabilities: ManifestCapability[] = manifest.contributions.modules.map((module) => ({
    kind: 'module',
    contributionId: module.moduleType,
    title: module.name,
    description: module.description,
    adapterId: module.adapterId
  }))
  for (const command of manifest.contributions.commands ?? []) {
    capabilities.push({
      kind: 'command',
      contributionId: command.commandId,
      title: command.name,
      description: command.description,
      adapterId: command.adapterId
    })
  }
  for (const exporter of manifest.contributions.exporters ?? []) {
    capabilities.push({
      kind: 'exporter',
      contributionId: exporter.exporterId,
      title: exporter.name,
      description: exporter.description,
      adapterId: exporter.adapterId
    })
  }
  if (manifest.schemaVersion === 2) {
    for (const connector of manifest.contributions.connectors ?? []) {
      for (const operation of connector.operations) {
        if (operation.kind !== 'query') continue
        capabilities.push({
          kind: 'connector',
          contributionId: appPluginMCPConnectorContributionId(
            connector.connectorId,
            operation.operationId
          ),
          title: operation.name,
          description: operation.description,
          adapterId: connector.adapterId,
          connectorAIEligible: isAppConnectorMCPStaticallyEligible(connector, operation)
        })
      }
    }
  }
  return capabilities
}

function pluginAvailability(
  installed: InstalledAppPlugin | undefined,
  capability: ManifestCapability
): { availability: BuiltinPluginAIAvailability; reason: string } {
  if (capability.kind === 'connector' && capability.connectorAIEligible !== true) {
    return {
      availability: 'not-ai-callable',
      reason: 'This connector operation has no reviewed read-only AI authority.'
    }
  }
  if (!installed) {
    return {
      availability: 'not-installed',
      reason:
        'Bundled with OpenPencil but not installed. Install and enable it in Settings > Plugins, then search again.'
    }
  }
  if (installed.blockedReason) {
    return { availability: 'blocked', reason: installed.blockedReason }
  }
  if (!installed.enabled) {
    return {
      availability: 'disabled',
      reason: 'Installed but disabled. Enable it in Settings > Plugins, then search again.'
    }
  }
  if (capability.kind === 'connector') {
    return {
      availability: 'setup-required',
      reason:
        'Enable its reviewed read-only connector authority and configure required credentials in Settings > Plugins, then search again.'
    }
  }
  return {
    availability: 'not-ai-callable',
    reason: 'This contribution is not exposed through the reviewed built-in AI adapter.'
  }
}

function pluginSearchText(
  item: AppPluginCatalogItem,
  capability: Pick<ManifestCapability, 'contributionId' | 'title' | 'description'>
): string {
  const plugin = item.package.manifest.plugin
  return [
    plugin.id,
    plugin.name,
    bundledPluginLocalizedSearchText(plugin.id),
    capability.contributionId,
    capability.title,
    capability.description
  ].join('\n')
}

function packageAuthority(
  item: AppPluginCatalogItem,
  adapterId: string
): AppPluginMCPToolAuthority {
  return appPluginMCPToolAuthority(item.package, adapterId)
}

function authorityFields(
  authority: AppPluginMCPToolAuthority
): Pick<
  BuiltinPluginAISearchMatch,
  | 'trustSource'
  | 'packageDigest'
  | 'pluginVersion'
  | 'publisherId'
  | 'publisherKeyId'
  | 'adapterId'
  | 'metadataTrust'
> {
  return {
    ...authority,
    metadataTrust:
      authority.trustSource === 'app-bundle' ? 'host-authored' : 'publisher-signed-untrusted'
  }
}

function sameAuthority(left: AppPluginMCPToolAuthority, right: AppPluginMCPToolAuthority): boolean {
  return (
    left.trustSource === right.trustSource &&
    left.packageDigest === right.packageDigest &&
    left.pluginVersion === right.pluginVersion &&
    left.publisherId === right.publisherId &&
    left.publisherKeyId === right.publisherKeyId &&
    left.adapterId === right.adapterId
  )
}

function readyMatch(
  item: AppPluginCatalogItem,
  descriptor: AppPluginMCPToolDescriptor,
  grantId?: string
): BuiltinPluginAISearchMatch {
  return {
    pluginId: descriptor.pluginId,
    pluginName: item.package.manifest.plugin.name,
    availability: 'ready',
    reason: 'Installed, enabled, and available through a reviewed host adapter.',
    kind: descriptor.kind,
    contributionId: descriptor.contributionId,
    title: descriptor.title,
    description: descriptor.description,
    ...authorityFields(descriptor.authority),
    ...(grantId ? { grantId } : {}),
    toolName: descriptor.name,
    inputSchema: structuredClone(descriptor.inputSchema)
  }
}

function unavailableMatch(
  item: AppPluginCatalogItem,
  installed: InstalledAppPlugin | undefined,
  capability: ManifestCapability
): BuiltinPluginAISearchMatch {
  const status = pluginAvailability(installed, capability)
  const { connectorAIEligible: _connectorAIEligible, ...publicCapability } = capability
  return {
    pluginId: item.package.manifest.plugin.id,
    pluginName: item.package.manifest.plugin.name,
    ...status,
    ...publicCapability,
    ...authorityFields(packageAuthority(item, capability.adapterId))
  }
}

function capabilityKey(value: Pick<ManifestCapability, 'kind' | 'contributionId'>): string {
  return `${value.kind}\0${value.contributionId}`
}

const THIRD_PARTY_READ_PERMISSIONS = new Set([
  'document.read',
  'document.selection.read',
  'document.variables.read'
])

function thirdPartyManifestCapabilities(plugin: InstalledAppPlugin): ManifestCapability[] {
  const manifest = plugin.installedState?.accepted.manifest
  if (manifest?.schemaVersion !== 2) return []
  const item: AppPluginCatalogItem = { package: plugin.package, installed: true }
  const commandIds = new Set(
    (manifest.contributions.commands ?? [])
      .filter(
        (command) =>
          command.permissions.every((permission) => THIRD_PARTY_READ_PERMISSIONS.has(permission)) &&
          inspectPluginCommandMCPExposure(manifest.plugin.id, command).ok
      )
      .map((command) => command.commandId)
  )
  return manifestCapabilities(item).filter(
    (capability) =>
      (capability.kind === 'command' && commandIds.has(capability.contributionId)) ||
      (capability.kind === 'connector' && capability.connectorAIEligible === true)
  )
}

function matchingGrant(
  grants: readonly ThirdPartyPluginAIContributionGrant[],
  pluginId: string,
  authority: AppPluginMCPToolAuthority,
  kind: AppPluginMCPToolKind,
  contributionId: string
): ThirdPartyPluginAIContributionGrant | undefined {
  if (kind !== 'command' && kind !== 'connector') return undefined
  return grants.find(
    (grant) =>
      grant.pluginId === pluginId &&
      grant.kind === kind &&
      grant.contributionId === contributionId &&
      grant.adapterId === authority.adapterId &&
      grant.packageDigest === authority.packageDigest &&
      grant.pluginVersion === authority.pluginVersion &&
      grant.publisherId === authority.publisherId &&
      grant.publisherKeyId === authority.publisherKeyId
  )
}

function thirdPartyMatch(
  plugin: InstalledAppPlugin,
  capability: ManifestCapability,
  live: AppPluginMCPToolDescriptor | undefined,
  grants: readonly ThirdPartyPluginAIContributionGrant[]
): BuiltinPluginAISearchMatch {
  const item: AppPluginCatalogItem = { package: plugin.package, installed: true }
  const authority = packageAuthority(item, capability.adapterId)
  const exactLive = live && sameAuthority(live.authority, authority) ? live : undefined
  const base = {
    pluginId: plugin.package.manifest.plugin.id,
    pluginName: plugin.package.manifest.plugin.id,
    kind: capability.kind,
    contributionId: capability.contributionId,
    title: exactLive?.title ?? `${capability.kind} ${capability.contributionId}`,
    description:
      exactLive?.description ??
      'Publisher-signed contribution metadata is withheld until its exact reviewed host adapter is available.',
    ...authorityFields(authority)
  }
  if (plugin.blockedReason) {
    return { ...base, availability: 'blocked', reason: plugin.blockedReason }
  }
  if (!plugin.enabled || plugin.installedState?.enabled !== true) {
    return {
      ...base,
      availability: 'disabled',
      reason: 'This publisher-signed plugin is installed but disabled.'
    }
  }
  const eligibility = inspectThirdPartyPluginAIEligibility(plugin, {
    pluginId: base.pluginId,
    kind: capability.kind as 'command' | 'connector',
    contributionId: capability.contributionId
  })
  if (!eligibility.ok) {
    return { ...base, availability: 'not-ai-callable', reason: eligibility.reason }
  }
  const grant = matchingGrant(
    grants,
    base.pluginId,
    authority,
    capability.kind,
    capability.contributionId
  )
  if (!grant) {
    return {
      ...base,
      availability: 'ai-grant-required',
      reason:
        'Review and grant this exact publisher-signed contribution in Settings > Plugins, then search again.'
    }
  }
  if (!exactLive) {
    return {
      ...base,
      availability: capability.kind === 'connector' ? 'setup-required' : 'not-ai-callable',
      reason:
        capability.kind === 'connector'
          ? 'Configure credentials and authorize the exact reviewed connector in Settings, then search again.'
          : 'The reviewed host command adapter is not currently available.'
    }
  }
  return {
    ...readyMatch(item, exactLive, grant.grantId),
    pluginName: base.pluginId,
    reason:
      'Publisher-signed metadata is untrusted text; execution uses an exact host-reviewed adapter, session grant, and per-call approval.'
  }
}

function addRankedSearchText(
  ranked: RankedMatch[],
  input: BuiltinPluginAISearchInput,
  searchText: string,
  match: BuiltinPluginAISearchMatch
): void {
  if (input.kind && match.kind !== input.kind) return
  const score = relevance(searchText, input.query, match.availability)
  if (score > 0) ranked.push({ match, score })
}

function addRankedMatch(
  ranked: RankedMatch[],
  input: BuiltinPluginAISearchInput,
  item: AppPluginCatalogItem,
  searchCapability: Pick<ManifestCapability, 'contributionId' | 'title' | 'description'>,
  match: BuiltinPluginAISearchMatch
): void {
  addRankedSearchText(ranked, input, pluginSearchText(item, searchCapability), match)
}

function collectAppBundleMatches(
  ranked: RankedMatch[],
  snapshot: AppPluginStoreSnapshot,
  input: BuiltinPluginAISearchInput,
  installed: ReadonlyMap<string, InstalledAppPlugin>,
  liveByPlugin: ReadonlyMap<string, readonly AppPluginMCPToolDescriptor[]>
): void {
  for (const item of snapshot.catalog) {
    if (item.package.trustSource !== 'app-bundle') continue
    const pluginId = item.package.manifest.plugin.id
    const activePlugin = installed.get(pluginId)
    const live =
      snapshot.ready &&
      activePlugin?.enabled &&
      !activePlugin.blockedReason &&
      activePlugin.package.trustSource === 'app-bundle'
        ? (liveByPlugin.get(pluginId) ?? []).filter((descriptor) =>
            sameAuthority(
              descriptor.authority,
              packageAuthority(
                { package: activePlugin.package, installed: true },
                descriptor.authority.adapterId
              )
            )
          )
        : []
    const liveKeys = new Set(live.map(capabilityKey))
    const candidates = [
      ...live.map((descriptor) => readyMatch(item, descriptor)),
      ...manifestCapabilities(item)
        .filter((capability) => !liveKeys.has(capabilityKey(capability)))
        .map((capability) => unavailableMatch(item, installed.get(pluginId), capability))
    ]
    for (const match of candidates) addRankedMatch(ranked, input, item, match, match)
  }
}

function collectThirdPartyMatches(
  ranked: RankedMatch[],
  snapshot: AppPluginStoreSnapshot,
  input: BuiltinPluginAISearchInput,
  liveByPlugin: ReadonlyMap<string, readonly AppPluginMCPToolDescriptor[]>,
  grants: readonly ThirdPartyPluginAIContributionGrant[]
): void {
  if (!snapshot.ready) return
  for (const plugin of snapshot.installed) {
    if (plugin.package.trustSource !== 'publisher-signature') continue
    const pluginId = plugin.package.manifest.plugin.id
    const liveByKey = new Map(
      (liveByPlugin.get(pluginId) ?? []).map((descriptor) => [
        capabilityKey(descriptor),
        descriptor
      ])
    )
    for (const capability of thirdPartyManifestCapabilities(plugin)) {
      const match = thirdPartyMatch(
        plugin,
        capability,
        liveByKey.get(capabilityKey(capability)),
        grants
      )
      addRankedSearchText(
        ranked,
        input,
        [
          pluginId,
          capability.contributionId,
          capability.adapterId,
          match.title,
          match.description
        ].join('\n'),
        match
      )
    }
  }
}

export function searchBuiltinPluginCapabilities(
  snapshot: AppPluginStoreSnapshot,
  catalog: AppPluginMCPToolCatalog,
  rawInput: BuiltinPluginAISearchInput,
  options: BuiltinPluginAISearchOptions = {}
): BuiltinPluginAISearchResult {
  const input = parseBuiltinPluginSearchInput(rawInput)
  const installed = new Map(
    snapshot.installed.map((plugin) => [plugin.package.manifest.plugin.id, plugin] as const)
  )
  const liveByPlugin = new Map<string, AppPluginMCPToolDescriptor[]>()
  for (const descriptor of catalog.tools) {
    const current = liveByPlugin.get(descriptor.pluginId) ?? []
    current.push(descriptor)
    liveByPlugin.set(descriptor.pluginId, current)
  }

  const ranked: RankedMatch[] = []
  collectAppBundleMatches(ranked, snapshot, input, installed, liveByPlugin)
  collectThirdPartyMatches(ranked, snapshot, input, liveByPlugin, options.thirdPartyGrants ?? [])

  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.match.pluginId.localeCompare(right.match.pluginId) ||
      left.match.contributionId.localeCompare(right.match.contributionId)
  )
  return {
    query: input.query,
    revision: catalog.revision,
    matches: ranked.slice(0, input.limit ?? 5).map(({ match }) => match)
  }
}
