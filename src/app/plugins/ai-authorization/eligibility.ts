import type {
  DeclarativeCommandContributionV2,
  PluginConnectorContractV1,
  PluginConnectorOperationV1,
  PluginManifestPayload,
  VerifiedPluginPackage
} from '@open-pencil/plugin-contracts'

import { isAppConnectorMCPStaticallyEligible } from '../connectors/app'
import { inspectPluginCommandMCPExposure } from '../host'
import { appPluginMCPConnectorContributionId } from '../mcp'
import type { InstalledAppPlugin } from '../types'
import type {
  ThirdPartyPluginAIContributionRequest,
  ThirdPartyPluginAIContributionReview,
  ThirdPartyPluginAIEligibility,
  ThirdPartyPluginAIEligibilityFailureCode,
  ThirdPartyPluginAIHostPolicy
} from './types'

const READ_ONLY_COMMAND_PERMISSIONS = new Set([
  'document.read',
  'document.selection.read',
  'document.variables.read'
])

type ThirdPartyPluginAIInspectionRequest = Readonly<
  Omit<ThirdPartyPluginAIContributionRequest, 'kind'> & { kind: string }
>

export const DEFAULT_THIRD_PARTY_PLUGIN_AI_HOST_POLICY: ThirdPartyPluginAIHostPolicy =
  Object.freeze({
    inspectCommand: (pluginId: string, contribution: DeclarativeCommandContributionV2) =>
      inspectPluginCommandMCPExposure(pluginId, contribution),
    isConnectorQueryEligible: (
      contribution: PluginConnectorContractV1,
      operation: PluginConnectorOperationV1
    ) => isAppConnectorMCPStaticallyEligible(contribution, operation)
  })

export class ThirdPartyPluginAIEligibilityError extends Error {
  constructor(
    readonly code: ThirdPartyPluginAIEligibilityFailureCode,
    message: string
  ) {
    super(message)
    this.name = 'ThirdPartyPluginAIEligibilityError'
  }
}

function failure(
  code: ThirdPartyPluginAIEligibilityFailureCode,
  reason: string
): ThirdPartyPluginAIEligibility {
  return Object.freeze({ ok: false, code, reason })
}

function sameManifestAuthority(left: PluginManifestPayload, right: PluginManifestPayload): boolean {
  return (
    left.plugin.id === right.plugin.id &&
    left.plugin.version === right.plugin.version &&
    left.publisher.id === right.publisher.id &&
    left.publisher.keyId === right.publisher.keyId
  )
}

function isExactActivePublisherPackage(
  plugin: InstalledAppPlugin,
  accepted: VerifiedPluginPackage
): boolean {
  const activeVerified = plugin.package.verifiedPackage
  return Boolean(
    activeVerified &&
    accepted.verifiedDigest === plugin.package.digest &&
    accepted.verifiedKeyId === accepted.manifest.publisher.keyId &&
    accepted.manifest.integrity.digest === accepted.verifiedDigest &&
    accepted.manifest.integrity.signature.keyId === accepted.verifiedKeyId &&
    sameManifestAuthority(accepted.manifest, plugin.package.manifest) &&
    activeVerified.verifiedDigest === accepted.verifiedDigest &&
    activeVerified.verifiedKeyId === accepted.verifiedKeyId &&
    activeVerified.manifest.integrity.digest === accepted.verifiedDigest &&
    sameManifestAuthority(activeVerified.manifest, accepted.manifest)
  )
}

function activePublisherPackage(plugin: InstalledAppPlugin | undefined):
  | Readonly<{ ok: true; accepted: VerifiedPluginPackage }>
  | Readonly<{
      ok: false
      code: ThirdPartyPluginAIEligibilityFailureCode
      reason: string
    }> {
  if (!plugin) {
    return { ok: false, code: 'plugin-unavailable', reason: 'Plugin is not installed' }
  }
  if (plugin.package.trustSource !== 'publisher-signature') {
    return {
      ok: false,
      code: 'not-publisher-signed',
      reason: 'Only publisher-signed plugins require third-party AI authorization'
    }
  }
  if (plugin.blockedReason) {
    return { ok: false, code: 'plugin-blocked', reason: plugin.blockedReason }
  }
  const installedState = plugin.installedState
  if (!installedState) {
    return {
      ok: false,
      code: 'signed-package-unavailable',
      reason: 'Plugin does not have an accepted publisher-signed package'
    }
  }
  if (!plugin.enabled || !installedState.enabled) {
    return { ok: false, code: 'plugin-disabled', reason: 'Plugin is disabled' }
  }
  const accepted = installedState.accepted
  if (!isExactActivePublisherPackage(plugin, accepted)) {
    return {
      ok: false,
      code: 'signed-package-unavailable',
      reason: 'Plugin does not have one exact active accepted publisher-signed package'
    }
  }
  return { ok: true, accepted }
}

function commandReview(
  accepted: VerifiedPluginPackage,
  request: ThirdPartyPluginAIContributionRequest,
  policy: ThirdPartyPluginAIHostPolicy
): ThirdPartyPluginAIEligibility {
  const manifest = accepted.manifest
  if (manifest.schemaVersion !== 2) {
    return failure(
      'manifest-version-denied',
      'Third-party AI commands require a version 2 declarative manifest'
    )
  }
  const matches = (manifest.contributions.commands ?? []).filter(
    (contribution) => contribution.commandId === request.contributionId
  )
  if (matches.length !== 1) {
    return failure('contribution-unavailable', 'Command contribution is unavailable or ambiguous')
  }
  const contribution = matches[0]
  if (
    contribution.permissions.some((permission) => !READ_ONLY_COMMAND_PERMISSIONS.has(permission))
  ) {
    return failure(
      'write-permission-denied',
      'Third-party AI commands may request only read-only document permissions'
    )
  }
  const hostReview = policy.inspectCommand(manifest.plugin.id, contribution)
  if (!hostReview.ok) return failure('host-review-denied', hostReview.reason)
  return Object.freeze({
    ok: true,
    review: Object.freeze({
      pluginId: manifest.plugin.id,
      kind: 'command',
      contributionId: contribution.commandId,
      adapterId: contribution.adapterId,
      packageDigest: accepted.verifiedDigest,
      pluginVersion: manifest.plugin.version,
      publisherId: manifest.publisher.id,
      publisherKeyId: accepted.verifiedKeyId
    })
  })
}

interface ConnectorMatch {
  contribution: PluginConnectorContractV1
  operation: PluginConnectorOperationV1
}

function connectorMatches(
  accepted: VerifiedPluginPackage,
  contributionId: string
): ConnectorMatch[] {
  if (accepted.manifest.schemaVersion !== 2) return []
  const matches: ConnectorMatch[] = []
  for (const contribution of accepted.manifest.contributions.connectors ?? []) {
    for (const operation of contribution.operations) {
      if (
        appPluginMCPConnectorContributionId(contribution.connectorId, operation.operationId) ===
        contributionId
      ) {
        matches.push({ contribution, operation })
      }
    }
  }
  return matches
}

function connectorReview(
  accepted: VerifiedPluginPackage,
  request: ThirdPartyPluginAIContributionRequest,
  policy: ThirdPartyPluginAIHostPolicy
): ThirdPartyPluginAIEligibility {
  if (accepted.manifest.schemaVersion !== 2) {
    return failure(
      'manifest-version-denied',
      'Third-party AI connectors require a version 2 declarative manifest'
    )
  }
  const matches = connectorMatches(accepted, request.contributionId)
  if (matches.length !== 1) {
    return failure('contribution-unavailable', 'Connector operation is unavailable or ambiguous')
  }
  const { contribution, operation } = matches[0]
  if (contribution.pluginId !== accepted.manifest.plugin.id) {
    return failure(
      'host-review-denied',
      'Connector contribution does not belong to the active signed plugin'
    )
  }
  if (operation.kind !== 'query') {
    return failure('mutation-denied', 'Third-party AI connector mutations are not allowed')
  }
  if (!policy.isConnectorQueryEligible(contribution, operation)) {
    return failure(
      'host-review-denied',
      'Connector query does not have exact reviewed read-only host authority'
    )
  }
  const manifest = accepted.manifest
  return Object.freeze({
    ok: true,
    review: Object.freeze({
      pluginId: manifest.plugin.id,
      kind: 'connector',
      contributionId: request.contributionId,
      connectorId: contribution.connectorId,
      operationId: operation.operationId,
      adapterId: contribution.adapterId,
      packageDigest: accepted.verifiedDigest,
      pluginVersion: manifest.plugin.version,
      publisherId: manifest.publisher.id,
      publisherKeyId: accepted.verifiedKeyId
    })
  })
}

export function inspectThirdPartyPluginAIEligibility(
  plugin: InstalledAppPlugin | undefined,
  request: ThirdPartyPluginAIInspectionRequest,
  policy: ThirdPartyPluginAIHostPolicy = DEFAULT_THIRD_PARTY_PLUGIN_AI_HOST_POLICY
): ThirdPartyPluginAIEligibility {
  if (request.kind !== 'command' && request.kind !== 'connector') {
    return failure(
      'contribution-kind-denied',
      'Third-party AI supports only read-only commands and reviewed query connectors'
    )
  }
  const active = activePublisherPackage(plugin)
  if (!active.ok) return failure(active.code, active.reason)
  if (active.accepted.manifest.plugin.id !== request.pluginId) {
    return failure('plugin-unavailable', 'Resolved plugin does not match the requested plugin')
  }
  return request.kind === 'command'
    ? commandReview(active.accepted, { ...request, kind: 'command' }, policy)
    : connectorReview(active.accepted, { ...request, kind: 'connector' }, policy)
}

export function reviewThirdPartyPluginAIContribution(
  plugin: InstalledAppPlugin | undefined,
  request: ThirdPartyPluginAIContributionRequest,
  policy: ThirdPartyPluginAIHostPolicy = DEFAULT_THIRD_PARTY_PLUGIN_AI_HOST_POLICY
): ThirdPartyPluginAIContributionReview {
  const result = inspectThirdPartyPluginAIEligibility(plugin, request, policy)
  if (!result.ok) throw new ThirdPartyPluginAIEligibilityError(result.code, result.reason)
  return result.review
}

export function listThirdPartyPluginAIContributionReviews(
  plugin: InstalledAppPlugin | undefined,
  policy: ThirdPartyPluginAIHostPolicy = DEFAULT_THIRD_PARTY_PLUGIN_AI_HOST_POLICY
): readonly ThirdPartyPluginAIContributionReview[] {
  const accepted = plugin?.installedState?.accepted
  if (accepted?.manifest.schemaVersion !== 2) return Object.freeze([])
  const pluginId = accepted.manifest.plugin.id
  const requests: ThirdPartyPluginAIContributionRequest[] = (
    accepted.manifest.contributions.commands ?? []
  ).map((contribution) => ({
    pluginId,
    kind: 'command',
    contributionId: contribution.commandId
  }))
  for (const contribution of accepted.manifest.contributions.connectors ?? []) {
    for (const operation of contribution.operations) {
      if (operation.kind !== 'query') continue
      requests.push({
        pluginId,
        kind: 'connector',
        contributionId: appPluginMCPConnectorContributionId(
          contribution.connectorId,
          operation.operationId
        )
      })
    }
  }
  const reviews = requests.flatMap((request) => {
    const result = inspectThirdPartyPluginAIEligibility(plugin, request, policy)
    return result.ok ? [result.review] : []
  })
  reviews.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.contributionId.localeCompare(right.contributionId)
  )
  return Object.freeze(reviews.map((review) => Object.freeze({ ...review })))
}
